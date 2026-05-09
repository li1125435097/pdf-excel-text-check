import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.compare_logic import compare_lists
from app.config import BASE_DIR, RECORDS_DIR, UPLOAD_DIR
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


def _file_path(rec: dict) -> Path:
    return UPLOAD_DIR / rec["stored_name"]


def _save_record(payload: dict) -> str:
    rid = str(uuid.uuid4())
    path = RECORDS_DIR / f"{rid}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return rid


def _list_record_summaries() -> list[dict]:
    summaries = []
    for p in sorted(RECORDS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
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
            }
        )
    return summaries


def _index_html() -> HTMLResponse:
    html_path = BASE_DIR / "templates" / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return _index_html()


@app.get("/files", response_class=HTMLResponse)
def index_files() -> HTMLResponse:
    return _index_html()


@app.get("/compare", response_class=HTMLResponse)
def index_compare() -> HTMLResponse:
    return _index_html()


@app.get("/records", response_class=HTMLResponse)
def index_records() -> HTMLResponse:
    return _index_html()


@app.get("/api/files")
def api_list_files() -> dict:
    return {"files": list_files()}


@app.post("/api/files")
async def api_upload(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    safe_name = Path(file.filename).name
    fid_stem = str(uuid.uuid4())
    ext = Path(safe_name).suffix
    stored = UPLOAD_DIR / f"{fid_stem}{ext}"
    content = await file.read()
    stored.write_bytes(content)
    rec = add_file_record(safe_name, stored, len(content), file.content_type)
    if ext.lower() == ".pdf":
        write_pdf_cache(stored, stored.name)
    return {"file": rec}


@app.delete("/api/files/{file_id}")
def api_delete_file(file_id: str) -> dict:
    rec = delete_file_record(file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    p = _file_path(rec)
    if p.exists():
        p.unlink()
    remove_pdf_cache(rec["stored_name"])
    return {"ok": True}


@app.patch("/api/files/{file_id}")
def api_rename_file(file_id: str, body: RenameBody) -> dict:
    rec = rename_file_record(file_id, body.display_name)
    if not rec:
        raise HTTPException(404, "文件不存在")
    return {"file": rec}


@app.post("/api/preview")
def api_preview(body: PreviewBody) -> dict:
    rec = get_file(body.file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    path = _file_path(rec)
    if not path.exists():
        raise HTTPException(400, "磁盘上找不到文件")
    if file_kind(rec.get("ext", "")) == "unknown":
        raise HTTPException(400, "该文件类型不支持预览")
    try:
        vals = extract_by_rules(path, rec.get("ext", ""), body.rules)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}") from e
    return {"preview": vals[:3], "total": len(vals)}


@app.post("/api/compare")
def api_compare(body: CompareBody) -> dict:
    left = get_file(body.left_file_id)
    right = get_file(body.right_file_id)
    if not left or not right:
        raise HTTPException(404, "文件不存在")
    lp = _file_path(left)
    rp = _file_path(right)
    if not lp.exists() or not rp.exists():
        raise HTTPException(400, "磁盘上找不到文件")
    try:
        left_values = extract_by_rules(lp, left.get("ext", ""), body.left_rules)
        right_values = extract_by_rules(rp, right.get("ext", ""), body.right_rules)
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
    }
    rid = _save_record({k: v for k, v in record.items() if k != "id"})
    record["id"] = rid
    record["check_message"] = "检查成功" if result["perfect"] and result["total"] > 0 else None
    return record


@app.get("/api/records")
def api_records() -> dict:
    return {"records": _list_record_summaries()}


@app.get("/api/records/{record_id}")
def api_record_detail(record_id: str) -> dict:
    path = RECORDS_DIR / f"{record_id}.json"
    if not path.exists():
        raise HTTPException(404, "记录不存在")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/file-kinds/{ext:path}")
def api_file_kind(ext: str) -> dict:
    e = ext if ext.startswith(".") else f".{ext}"
    return {"ext": e, "kind": file_kind(e)}
