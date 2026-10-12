import pytest

from app.errors import PathEscapeError
from app.services.paths import resolve_inside


def test_resolve_inside_rejects_escape(tmp_path):
    assert resolve_inside(tmp_path, "uploads/video.mp4") == (tmp_path / "uploads" / "video.mp4").resolve()
    with pytest.raises(PathEscapeError):
        resolve_inside(tmp_path, "../etc/passwd")
    with pytest.raises(PathEscapeError):
        resolve_inside(tmp_path, "/etc/passwd")
