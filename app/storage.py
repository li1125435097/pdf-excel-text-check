import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import META_PATH, ensure_meta_file


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_meta() -> dict[str, Any]:
    ensure_meta_file()
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def save_meta(data: dict[str, Any]) -> None:
    META_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_files() -> list[dict[str, Any]]:
    return load_meta().get("files", [])


def get_file(fid: str) -> dict[str, Any] | None:
    for f in list_files():
        if f["id"] == fid:
            return f
    return None


def add_file_record(
    display_name: str,
    stored_path: Path,
    size: int,
    mime: str | None,
) -> dict[str, Any]:
    data = load_meta()
    fid = str(uuid.uuid4())
    ts = _now_iso()
    ext = Path(display_name).suffix.lower()
    rec = {
        "id": fid,
        "display_name": display_name,
        "stored_name": stored_path.name,
        "size": size,
        "mime": mime or "",
        "uploaded_at": ts,
        "modified_at": ts,
        "ext": ext,
    }
    data.setdefault("files", []).append(rec)
    save_meta(data)
    return rec


def delete_file_record(fid: str) -> dict[str, Any] | None:
    data = load_meta()
    files = data.get("files", [])
    removed = None
    new_files = []
    for f in files:
        if f["id"] == fid:
            removed = f
        else:
            new_files.append(f)
    if removed:
        data["files"] = new_files
        save_meta(data)
    return removed


def rename_file_record(fid: str, new_display_name: str) -> dict[str, Any] | None:
    data = load_meta()
    for f in data.get("files", []):
        if f["id"] == fid:
            f["display_name"] = new_display_name.strip() or f["display_name"]
            f["modified_at"] = _now_iso()
            save_meta(data)
            return f
    return None
