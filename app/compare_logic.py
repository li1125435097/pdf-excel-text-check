from typing import Any


def compare_lists(left: list[str], right: list[str]) -> dict[str, Any]:
    n = max(len(left), len(right))
    rows: list[dict[str, Any]] = []
    ok = 0
    fail = 0
    for i in range(n):
        a = left[i] if i < len(left) else None
        b = right[i] if i < len(right) else None
        if a is None or b is None:
            same = False
        else:
            same = a.strip() == b.strip()
        if same:
            ok += 1
        else:
            fail += 1
        rows.append(
            {
                "index": i + 1,
                "left": a,
                "right": b,
                "ok": same,
            }
        )
    total = n
    rate = (ok / total * 100.0) if total else 0.0
    return {
        "items": rows,
        "total": total,
        "success": ok,
        "failed": fail,
        "success_rate": round(rate, 2),
        "perfect": total > 0 and fail == 0,
    }
