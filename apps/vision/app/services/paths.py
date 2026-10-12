from __future__ import annotations

from pathlib import Path

from app.errors import PathEscapeError


def resolve_inside(root: Path, candidate: str | Path) -> Path:
    raw = str(candidate)
    if "\x00" in raw:
        raise PathEscapeError()
    root_resolved = root.resolve()
    candidate_path = Path(candidate)
    resolved = candidate_path.resolve() if candidate_path.is_absolute() else (root_resolved / candidate_path).resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise PathEscapeError() from exc
    return resolved


def relative_to_root(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()
