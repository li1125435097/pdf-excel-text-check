import re
from pathlib import Path
from typing import Any

import pandas as pd
import pdfplumber

from app.pdf_cache import load_pdf_lines_cache, write_pdf_cache_pages
from app.pdf_pages import extract_pdf_pages_lines


def file_kind(ext: str) -> str:
    e = ext.lower()
    if e in (".xlsx", ".xls"):
        return "excel"
    if e == ".pdf":
        return "pdf"
    if e in (".txt", ".csv", ".log", ".md"):
        return "text"
    return "unknown"


def col_letter_to_index(col: str) -> int:
    col = col.strip().upper()
    n = 0
    for c in col:
        if "A" <= c <= "Z":
            n = n * 26 + (ord(c) - ord("A") + 1)
        else:
            break
    return max(0, n - 1)


def resolve_col_idx(column: str | int) -> int:
    if isinstance(column, int):
        return max(0, column - 1)
    s = str(column).strip()
    if s.isdigit():
        return max(0, int(s) - 1)
    return col_letter_to_index(s)


def extract_excel(
    path: Path,
    sheet_index: int,
    column: str | int,
) -> list[str]:
    col_idx = resolve_col_idx(column)
    df = pd.read_excel(path, sheet_name=sheet_index, header=None, dtype=object)
    if df.empty or col_idx >= df.shape[1]:
        return []
    series = df.iloc[:, col_idx]
    out: list[str] = []
    for v in series:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            s = ""
        else:
            s = str(v).strip()
        if not s:
            continue
        out.append(s)
    return out


def extract_pdf_lines_from_pages(
    pages_lines: list[list[str]],
    line_indices_1based: list[int],
) -> list[str]:
    out: list[str] = []
    for lines in pages_lines:
        for li in line_indices_1based:
            idx = li - 1
            if idx < 0 or idx >= len(lines):
                continue
            s = lines[idx].strip()
            if not s:
                continue
            out.append(s)
    return out


def extract_pdf(
    path: Path,
    line_indices_1based: list[int],
    *,
    stored_name: str | None = None,
) -> list[str]:
    """优先使用上传时生成的行缓存；缺失则当场用 pdfplumber 解析（兼容旧文件）。"""
    name = stored_name or path.name
    cached = load_pdf_lines_cache(name)
    if cached is not None:
        return extract_pdf_lines_from_pages(cached, line_indices_1based)
    pages_lines = extract_pdf_pages_lines(path)
    if stored_name:
        write_pdf_cache_pages(pages_lines, stored_name)
    return extract_pdf_lines_from_pages(pages_lines, line_indices_1based)


def extract_text_file(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()
    out: list[str] = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        out.append(s)
    return out


def _strip_all_whitespace(s: str) -> str:
    return "".join(str(s).split())


def _apply_remove_spaces_then_regex(
    vals: list[str],
    remove_spaces: bool,
    pattern: re.Pattern[str] | None,
) -> list[str]:
    """先按规则移除全部空白，再执行正则（与界面说明一致：正则匹配在移除空格之后）。"""
    out: list[str] = []
    for s in vals:
        t = _strip_all_whitespace(s) if remove_spaces else s
        if pattern:
            m = pattern.search(t)
            if not m:
                continue
            t = m.group(0).strip()
        out.append(t)
    return out


def extract_by_rules(
    path: Path,
    ext: str,
    rules: dict[str, Any],
    *,
    stored_name: str | None = None,
) -> list[str]:
    r = dict(rules or {})
    skip_raw = r.pop("skip_first", 0)
    remove_spaces = bool(r.pop("remove_spaces", True))
    regex_raw = r.get("regex") or None
    pattern = re.compile(regex_raw.strip()) if regex_raw and str(regex_raw).strip() else None
    try:
        skip = max(0, int(skip_raw))
    except (TypeError, ValueError):
        skip = 0

    kind = file_kind(ext)
    if kind == "excel":
        vals = extract_excel(
            path,
            int(r.get("sheet_index", 0)),
            r.get("column", "A"),
        )
    elif kind == "pdf":
        raw_lines = r.get("line_indices") or r.get("line_indices_1based") or [1]
        if isinstance(raw_lines, str):
            line_indices = [int(x.strip()) for x in raw_lines.split(",") if x.strip().isdigit()]
        else:
            line_indices = [int(x) for x in raw_lines]
        if not line_indices:
            line_indices = [1]
        vals = extract_pdf(path, line_indices, stored_name=stored_name)
    elif kind == "text":
        vals = extract_text_file(path)
    else:
        raise ValueError(f"不支持的文件类型: {ext}")

    vals = _apply_remove_spaces_then_regex(vals, remove_spaces, pattern)

    return vals[skip:]
