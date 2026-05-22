import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.sessions import SessionMiddleware

from app.auth_util import (
    GUEST_ACCOUNT_EMAIL,
    can_access_owner_field,
    is_super_admin,
    normalize_email,
    store_and_send_otp,
    verify_otp,
)
from app.compare_logic import compare_lists
from app.config import BASE_DIR, MAX_UPLOAD_BYTES, RECORDS_DIR, SESSION_SECRET, UPLOAD_DIR
from app.extractors import extract_by_rules, file_kind
from app.pdf_cache import remove_pdf_cache, write_pdf_cache
from app.storage import (
    add_file_record,
    delete_file_record,
    get_file,
    list_files,
    rename_file_record,
)

app = FastAPI(title="pdf-excel-text-check")

app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=14 * 24 * 3600, same_site="lax")

static_dir = BASE_DIR / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


class RenameBody(BaseModel):
    display_name: str


class CompareBody(BaseModel):
    left_file_id: str
    right_file_id: str
    left_rules: dict = Field(default_factory=dict)
    right_rules: dict = Field(default_factory=dict)


class PreviewBody(BaseModel):
    file_id: str
    rules: dict = Field(default_factory=dict)


class SendCodeBody(BaseModel):
    email: EmailStr


class LoginBody(BaseModel):
    email: EmailStr
    code: str


@dataclass(frozen=True)
class AuthUser:
    email: str
    is_guest: bool

    @property
    def is_super(self) -> bool:
        return is_super_admin(self.email) and not self.is_guest


def _login_html() -> HTMLResponse:
    path = BASE_DIR / "templates" / "login.html"
    return HTMLResponse(path.read_text(encoding="utf-8"))


def get_auth_user(request: Request) -> AuthUser:
    raw = request.session.get("email")
    if not raw:
        raise HTTPException(status_code=401, detail="未登录")
    return AuthUser(
        email=normalize_email(str(raw)),
        is_guest=bool(request.session.get("guest")),
    )


def assert_file_access(rec: dict, user_email: str, super_u: bool) -> None:
    if not can_access_owner_field(rec.get("owner_email"), user_email, super_u):
        raise HTTPException(status_code=403, detail="无权访问该文件")


def visible_files(user_email: str, super_u: bool) -> list[dict]:
    all_f = list_files()
    if super_u:
        return all_f
    return [f for f in all_f if can_access_owner_field(f.get("owner_email"), user_email, False)]


def _file_path(rec: dict) -> Path:
    return UPLOAD_DIR / rec["stored_name"]


def _save_record(payload: dict) -> str:
    rid = str(uuid.uuid4())
    path = RECORDS_DIR / f"{rid}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return rid


def _list_record_summaries_filtered(user_email: str, super_u: bool) -> list[dict]:
    summaries = []
    for p in sorted(RECORDS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        owner = data.get("owner_email")
        if not can_access_owner_field(owner, user_email, super_u):
            continue
        summaries.append(
            {
                "id": p.stem,
                "left_name": data.get("left_name", ""),
                "right_name": data.get("right_name", ""),
                "compared_at": data.get("compared_at", ""),
                "total": data.get("total", 0),
                "success": data.get("success", 0),
                "failed": data.get("failed", 0),
                "success_rate": data.get("success_rate", 0),
                "owner_email": owner or "",
            }
        )
    return summaries


def _index_html() -> HTMLResponse:
    html_path = BASE_DIR / "templates" / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


def _redirect_if_not_logged_in(request: Request) -> RedirectResponse | None:
    if not request.session.get("email"):
        return RedirectResponse(url="/login", status_code=302)
    return None


@app.get("/login", response_class=HTMLResponse, response_model=None)
def login_page(request: Request) -> HTMLResponse | RedirectResponse:
    if request.session.get("email"):
        return RedirectResponse(url="/files", status_code=302)
    return _login_html()


@app.get("/", response_class=HTMLResponse, response_model=None)
def index(request: Request) -> HTMLResponse | RedirectResponse:
    r = _redirect_if_not_logged_in(request)
    if r:
        return r
    return _index_html()


@app.get("/files", response_class=HTMLResponse, response_model=None)
def index_files(request: Request) -> HTMLResponse | RedirectResponse:
    r = _redirect_if_not_logged_in(request)
    if r:
        return r
    return _index_html()


@app.get("/compare", response_class=HTMLResponse, response_model=None)
def index_compare(request: Request) -> HTMLResponse | RedirectResponse:
    r = _redirect_if_not_logged_in(request)
    if r:
        return r
    return _index_html()


@app.get("/records", response_class=HTMLResponse, response_model=None)
def index_records(request: Request) -> HTMLResponse | RedirectResponse:
    r = _redirect_if_not_logged_in(request)
    if r:
        return r
    return _index_html()


@app.post("/api/auth/send-code")
def api_send_code(body: SendCodeBody) -> dict:
    try:
        msg, dev_code = store_and_send_otp(body.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    out: dict = {"message": msg}
    if dev_code is not None:
        out["debug_code"] = dev_code
    return out


@app.post("/api/auth/login")
def api_login(request: Request, body: LoginBody) -> dict:
    email = normalize_email(str(body.email))
    if not verify_otp(email, body.code):
        raise HTTPException(status_code=400, detail="验证码错误或已过期")
    request.session["email"] = email
    request.session["guest"] = False
    return {"email": email, "is_super_admin": is_super_admin(email), "is_guest": False}


@app.post("/api/auth/guest-login")
def api_guest_login(request: Request) -> dict:
    email = normalize_email(GUEST_ACCOUNT_EMAIL)
    request.session["email"] = email
    request.session["guest"] = True
    return {"email": email, "is_super_admin": False, "is_guest": True}


@app.post("/api/auth/logout")
def api_logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@app.get("/api/auth/me")
def api_me(request: Request) -> dict:
    raw = request.session.get("email")
    if not raw:
        return {"email": None, "is_super_admin": False, "is_guest": False}
    em = normalize_email(str(raw))
    guest = bool(request.session.get("guest"))
    return {
        "email": em,
        "is_super_admin": is_super_admin(em) and not guest,
        "is_guest": guest,
    }


@app.get("/api/files")
def api_list_files(auth: AuthUser = Depends(get_auth_user)) -> dict:
    return {"files": visible_files(auth.email, auth.is_super)}


@app.post("/api/files")
async def api_upload(
    file: UploadFile = File(...),
    auth: AuthUser = Depends(get_auth_user),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    safe_name = Path(file.filename).name
    fid_stem = str(uuid.uuid4())
    ext = Path(safe_name).suffix
    stored = UPLOAD_DIR / f"{fid_stem}{ext}"
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "单文件大小不能超过 10MB")
    stored.write_bytes(content)
    rec = add_file_record(safe_name, stored, len(content), file.content_type, auth.email)
    if ext.lower() == ".pdf":
        write_pdf_cache(stored, stored.name)
    return {"file": rec}


@app.delete("/api/files/{file_id}")
def api_delete_file(file_id: str, auth: AuthUser = Depends(get_auth_user)) -> dict:
    rec = get_file(file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    assert_file_access(rec, auth.email, auth.is_super)
    removed = delete_file_record(file_id)
    if not removed:
        raise HTTPException(404, "文件不存在")
    p = _file_path(rec)
    if p.exists():
        p.unlink()
    remove_pdf_cache(rec["stored_name"])
    return {"ok": True}


@app.patch("/api/files/{file_id}")
def api_rename_file(file_id: str, body: RenameBody, auth: AuthUser = Depends(get_auth_user)) -> dict:
    rec = get_file(file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    assert_file_access(rec, auth.email, auth.is_super)
    out = rename_file_record(file_id, body.display_name)
    if not out:
        raise HTTPException(404, "文件不存在")
    return {"file": out}


@app.post("/api/preview")
def api_preview(body: PreviewBody, auth: AuthUser = Depends(get_auth_user)) -> dict:
    rec = get_file(body.file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    assert_file_access(rec, auth.email, auth.is_super)
    path = _file_path(rec)
    if not path.exists():
        raise HTTPException(400, "磁盘上找不到文件")
    if file_kind(rec.get("ext", "")) == "unknown":
        raise HTTPException(400, "该文件类型不支持预览")
    try:
        vals = extract_by_rules(
            path,
            rec.get("ext", ""),
            body.rules,
            stored_name=rec.get("stored_name"),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}") from e
    return {"preview": vals[:3], "total": len(vals)}


@app.post("/api/compare")
def api_compare(body: CompareBody, auth: AuthUser = Depends(get_auth_user)) -> dict:
    left = get_file(body.left_file_id)
    right = get_file(body.right_file_id)
    if not left or not right:
        raise HTTPException(404, "文件不存在")
    assert_file_access(left, auth.email, auth.is_super)
    assert_file_access(right, auth.email, auth.is_super)
    lp = _file_path(left)
    rp = _file_path(right)
    if not lp.exists() or not rp.exists():
        raise HTTPException(400, "磁盘上找不到文件")
    try:
        left_values = extract_by_rules(
            lp,
            left.get("ext", ""),
            body.left_rules,
            stored_name=left.get("stored_name"),
        )
        right_values = extract_by_rules(
            rp,
            right.get("ext", ""),
            body.right_rules,
            stored_name=right.get("stored_name"),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}") from e
    result = compare_lists(left_values, right_values)
    compared_at = datetime.now(timezone.utc).isoformat()
    record = {
        "id": None,
        "left_name": left["display_name"],
        "right_name": right["display_name"],
        "compared_at": compared_at,
        "total": result["total"],
        "success": result["success"],
        "failed": result["failed"],
        "success_rate": result["success_rate"],
        "perfect": result["perfect"],
        "items": result["items"],
        "left_rules": body.left_rules,
        "right_rules": body.right_rules,
        "owner_email": auth.email,
    }
    rid = _save_record({k: v for k, v in record.items() if k != "id"})
    record["id"] = rid
    record["check_message"] = "检查成功" if result["perfect"] and result["total"] > 0 else None
    return record


@app.get("/api/records")
def api_records(auth: AuthUser = Depends(get_auth_user)) -> dict:
    return {"records": _list_record_summaries_filtered(auth.email, auth.is_super)}


@app.get("/api/records/{record_id}")
def api_record_detail(record_id: str, auth: AuthUser = Depends(get_auth_user)) -> dict:
    path = RECORDS_DIR / f"{record_id}.json"
    if not path.exists():
        raise HTTPException(404, "记录不存在")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not can_access_owner_field(data.get("owner_email"), auth.email, auth.is_super):
        raise HTTPException(403, "无权查看该记录")
    return data


@app.get("/api/file-kinds/{ext:path}")
def api_file_kind(ext: str, _auth: AuthUser = Depends(get_auth_user)) -> dict:
    e = ext if ext.startswith(".") else f".{ext}"
    return {"ext": e, "kind": file_kind(e)}
