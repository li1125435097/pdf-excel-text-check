import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# 单文件上传大小上限（字节）
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Starlette SessionMiddleware 密钥；生产环境务必设置环境变量
SESSION_SECRET = os.environ.get("SESSION_SECRET", "dev-session-secret-change-me")
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
META_PATH = BASE_DIR / "data" / "files_meta.json"
RECORDS_DIR = BASE_DIR / "static" / "records"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RECORDS_DIR.mkdir(parents=True, exist_ok=True)


def ensure_meta_file() -> None:
    if not META_PATH.exists():
        META_PATH.parent.mkdir(parents=True, exist_ok=True)
        META_PATH.write_text('{"files":[]}', encoding="utf-8")
