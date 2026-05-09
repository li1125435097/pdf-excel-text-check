from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
META_PATH = BASE_DIR / "data" / "files_meta.json"
RECORDS_DIR = BASE_DIR / "static" / "records"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RECORDS_DIR.mkdir(parents=True, exist_ok=True)


def ensure_meta_file() -> None:
    if not META_PATH.exists():
        META_PATH.parent.mkdir(parents=True, exist_ok=True)
        META_PATH.write_text('{"files":[]}', encoding="utf-8")
