"""PDF 文本缓存：上传时解析并落盘，预览/对比只读 JSON，避免重复 pdfplumber 解析。"""

import json
from pathlib import Path

import pdfplumber

from app.config import BASE_DIR

PDF_CACHE_DIR = BASE_DIR / "data" / "pdf_cache"
PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)

CACHE_VERSION = 1


def cache_path_for_stored_name(stored_name: str) -> Path:
    """与磁盘上的 uploads 文件名对应，例如 uuid.pdf -> uuid.pdf.lines.json"""
    return PDF_CACHE_DIR / f"{stored_name}.lines.json"


def build_pages_lines(pdf_path: Path) -> list[list[str]]:
    pages: list[list[str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text.splitlines())
    return pages


def write_pdf_cache(pdf_path: Path, stored_name: str) -> Path | None:
    """上传成功后调用：解析 PDF 并写入与 stored_name 对应的缓存文件。"""
    if pdf_path.suffix.lower() != ".pdf":
        return None
    try:
        pages = build_pages_lines(pdf_path)
    except Exception:
        return None
    out = cache_path_for_stored_name(stored_name)
    payload = {"version": CACHE_VERSION, "stored_name": stored_name, "pages": pages}
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return out


def load_pdf_lines_cache(stored_name: str) -> list[list[str]] | None:
    """读取缓存；缺失或损坏返回 None，调用方回退到直接解析 PDF。"""
    path = cache_path_for_stored_name(stored_name)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        pages = data.get("pages")
        if not isinstance(pages, list):
            return None
        out: list[list[str]] = []
        for p in pages:
            if isinstance(p, list) and all(isinstance(line, str) for line in p):
                out.append(p)
            else:
                return None
        return out
    except (json.JSONDecodeError, OSError, TypeError):
        return None


def remove_pdf_cache(stored_name: str) -> None:
    path = cache_path_for_stored_name(stored_name)
    if path.exists():
        path.unlink()
