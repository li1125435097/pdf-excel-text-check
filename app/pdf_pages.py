"""PDF 按页取行文本：优先 pdfplumber 文本层；若整份无有效文本则回退 PaddleOCR（扫描/图片型 PDF）。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pdfplumber

logger = logging.getLogger(__name__)

_paddle_ocr: Any = None


def pages_have_no_extractable_text(pages: list[list[str]]) -> bool:
    for page in pages:
        for line in page:
            if line and str(line).strip():
                return False
    return True


def extract_pages_lines_pdfplumber(pdf_path: Path) -> list[list[str]]:
    pages: list[list[str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text.splitlines())
    return pages


def _get_paddle_ocr() -> Any:
    global _paddle_ocr
    if _paddle_ocr is None:
        from paddleocr import PaddleOCR

        _paddle_ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    return _paddle_ocr


def _ocr_lines_from_paddle_result(result: Any) -> list[str]:
    if not result:
        return []
    block = result[0] if isinstance(result, list) else result
    if block is None:
        return []
    if not isinstance(block, list):
        return []
    keyed: list[tuple[tuple[float, float], str]] = []
    for item in block:
        if not item or not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        box, rest = item[0], item[1]
        if isinstance(rest, (list, tuple)) and rest:
            text = str(rest[0]).strip()
        else:
            text = str(rest).strip()
        if not text:
            continue
        try:
            ys = [float(p[1]) for p in box]
            xs = [float(p[0]) for p in box]
            cy = sum(ys) / len(ys)
            cx = sum(xs) / len(xs)
        except (TypeError, ValueError, IndexError):
            cx, cy = 0.0, 0.0
        keyed.append(((cy, cx), text))
    keyed.sort(key=lambda t: t[0])
    return [t[1] for t in keyed]


def extract_pages_lines_paddle_ocr(pdf_path: Path, *, zoom: float = 2.0) -> list[list[str]]:
    try:
        import fitz
        import numpy as np
    except ImportError:
        logger.warning("未安装 pymupdf 或 numpy，无法进行 PDF 扫描件 OCR")
        return []
    try:
        ocr = _get_paddle_ocr()
    except Exception as e:
        logger.warning("PaddleOCR 初始化失败: %s", e)
        return []

    out: list[list[str]] = []
    doc = fitz.open(pdf_path)
    try:
        mat = fitz.Matrix(zoom, zoom)
        for i in range(len(doc)):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            h, w, n = pix.height, pix.width, pix.n
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(h, w, n)
            if n == 1:
                img = np.repeat(arr, 3, axis=2)
            elif n == 4:
                img = arr[:, :, :3]
            else:
                img = arr
            try:
                res = ocr.ocr(img, cls=True)
            except Exception as e:
                logger.warning("PaddleOCR 第 %s 页失败: %s", i + 1, e)
                out.append([])
                continue
            out.append(_ocr_lines_from_paddle_result(res))
    finally:
        doc.close()
    return out


def extract_pdf_pages_lines(pdf_path: Path) -> list[list[str]]:
    pages: list[list[str]] = []
    try:
        pages = extract_pages_lines_pdfplumber(pdf_path)
    except Exception as e:
        logger.warning("pdfplumber 解析失败，将尝试 OCR: %s", e)
        pages = []
    if pages and not pages_have_no_extractable_text(pages):
        return pages
    ocr_pages = extract_pages_lines_paddle_ocr(pdf_path)
    if ocr_pages:
        return ocr_pages
    return pages
