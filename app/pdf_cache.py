"""PDF 文本缓存：上传时解析并落盘，预览/对比只读 JSON，避免重复 pdfplumber 解析。"""

import json
from pathlib import Path

from app.config import BASE_DIR
from app.pdf_pages import extract_pdf_pages_lines, pages_have_no_extractable_text

PDF_CACHE_DIR = BASE_DIR / "data" / "pdf_cache"
PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)

CACHE_VERSION = 2


def cache_path_for_stored_name(stored_name: str) -> Path:
    """与磁盘上的 uploads 文件名对应，例如 uuid.pdf -> uuid.pdf.lines.json"""
    return PDF_CACHE_DIR / f"{stored_name}.lines.json"


def build_pages_lines(pdf_path: Path) -> list[list[str]]:
    return extract_pdf_pages_lines(pdf_path)


def write_pdf_cache_pages(pages: list[list[str]], stored_name: str) -> Path:
    """将已解析的按页行文本写入缓存（避免在修正扫描件缓存时重复 OCR）。"""
    out = cache_path_for_stored_name(stored_name)
    payload = {"version": CACHE_VERSION, "stored_name": stored_name, "pages": pages}
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return out


def write_pdf_cache(pdf_path: Path, stored_name: str) -> Path | None:
    """上传成功后调用：解析 PDF 并写入与 stored_name 对应的缓存文件。"""
    if pdf_path.suffix.lower() != ".pdf":
        return None
    try:
        pages = build_pages_lines(pdf_path)
    except Exception:
        return None
    return write_pdf_cache_pages(pages, stored_name)


def load_pdf_lines_cache(stored_name: str) -> list[list[str]] | None:
    """读取缓存；缺失、损坏或各页均无有效文本时返回 None（触发含 OCR 的重新解析）。"""
    path = cache_path_for_stored_name(stored_name)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        pages = data.get("pages")
        if not isinstance(pages, list):
            return None
        try:
            version = int(data.get("version", 1))
        except (TypeError, ValueError):
            version = 1
        out: list[list[str]] = []
        for p in pages:
            if isinstance(p, list) and all(isinstance(line, str) for line in p):
                out.append(p)
            else:
                return None
        if pages_have_no_extractable_text(out) and version < 2:
            return None
        return out
    except (json.JSONDecodeError, OSError, TypeError):
        return None


def remove_pdf_cache(stored_name: str) -> None:
    path = cache_path_for_stored_name(stored_name)
    if path.exists():
        path.unlink()
