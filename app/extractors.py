import re
from pathlib import Path
from typing import Any

import pandas as pd
import pdfplumber

from app.pdf_cache import load_pdf_lines_cache


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
    regex_pattern: str | None,
) -> list[str]:
    col_idx = resolve_col_idx(column)
    df = pd.read_excel(path, sheet_name=sheet_index, header=None, dtype=object)
    if df.empty or col_idx >= df.shape[1]:
        return []
    series = df.iloc[:, col_idx]
    out: list[str] = []
    pattern = re.compile(regex_pattern.strip()) if regex_pattern and regex_pattern.strip() else None
    for v in series:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            s = ""
        else:
            s = str(v).strip()
        if not s:
            continue
        if pattern:
            m = pattern.search(s)
            if not m:
                continue
            s = m.group(0).strip()
        out.append(s)
    return out


def extract_pdf_lines_from_pages(
    pages_lines: list[list[str]],
    line_indices_1based: list[int],
    regex_pattern: str | None,
) -> list[str]:
    pattern = re.compile(regex_pattern.strip()) if regex_pattern and regex_pattern.strip() else None
    out: list[str] = []
    for lines in pages_lines:
        for li in line_indices_1based:
            idx = li - 1
            if idx < 0 or idx >= len(lines):
                continue
            s = lines[idx].strip()
            if not s:
                continue
            if pattern:
                m = pattern.search(s)
                if not m:
                    continue
                s = m.group(0).strip()
            out.append(s)
    return out


def extract_pdf(
    path: Path,
    line_indices_1based: list[int],
    regex_pattern: str | None,
    *,
    stored_name: str | None = None,
) -> list[str]:
    """优先使用上传时生成的行缓存；缺失则当场用 pdfplumber 解析（兼容旧文件）。"""
    name = stored_name or path.name
    cached = load_pdf_lines_cache(name)
    if cached is not None:
        return extract_pdf_lines_from_pages(cached, line_indices_1based, regex_pattern)
    pages_lines: list[list[str]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages_lines.append(text.splitlines())
    return extract_pdf_lines_from_pages(pages_lines, line_indices_1based, regex_pattern)


def extract_text_file(path: Path, regex_pattern: str | None) -> list[str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()
    pattern = re.compile(regex_pattern.strip()) if regex_pattern and regex_pattern.strip() else None
    out: list[str] = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if pattern:
            m = pattern.search(s)
            if not m:
                continue
            s = m.group(0).strip()
        out.append(s)
    return out


def extract_by_rules(path: Path, ext: str, rules: dict[str, Any]) -> list[str]:
    r = dict(rules or {})
    skip_raw = r.pop("skip_first", 0)
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
            r.get("regex") or None,
        )
    elif kind == "pdf":
        raw_lines = r.get("line_indices") or r.get("line_indices_1based") or [1]
        if isinstance(raw_lines, str):
            line_indices = [int(x.strip()) for x in raw_lines.split(",") if x.strip().isdigit()]
        else:
            line_indices = [int(x) for x in raw_lines]
        if not line_indices:
            line_indices = [1]
        vals = extract_pdf(path, line_indices, r.get("regex") or None)
    elif kind == "text":
        vals = extract_text_file(path, r.get("regex") or None)
    else:
        raise ValueError(f"不支持的文件类型: {ext}")

    return vals[skip:]
