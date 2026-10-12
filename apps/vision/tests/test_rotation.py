import subprocess

import numpy as np

from app.video.decode import iter_bgr_frames
from app.video.rotation import apply_display_rotation, normalize_right_angle


def test_right_angle_normalization():
    assert normalize_right_angle(-90) == (270, None)
    assert normalize_right_angle(90) == (90, None)
    assert normalize_right_angle(180) == (180, None)
    rotation, warning = normalize_right_angle(20)
    assert rotation == 0
    assert warning


def test_display_rotation_matches_ffmpeg_autorotate(tmp_path):
    source = tmp_path / "pattern.mp4"
    rotated = tmp_path / "rotated.mp4"
    subprocess.check_call([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=80x40:d=0.2",
        "-vf", "drawbox=x=0:y=0:w=10:h=40:color=white:t=fill",
        "-pix_fmt", "yuv420p", str(source),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.check_call([
        "ffmpeg", "-y", "-display_rotation:v:0", "90", "-i", str(source), "-c", "copy", str(rotated),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _index, image = next(iter_bgr_frames(rotated, 90))
    reference = ffmpeg_frame(rotated)
    assert image.shape[:2] == reference.shape[:2]
    assert white_edge(image) == white_edge(reference) == "bottom"


def ffmpeg_frame(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1",
    ])
    height, width = 80, 40
    return np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3))


def white_edge(image: np.ndarray) -> str:
    height, width = image.shape[:2]
    samples = {
        "left": image[height // 2, 2, 0] > 200,
        "right": image[height // 2, width - 3, 0] > 200,
        "top": image[2, width // 2, 0] > 200,
        "bottom": image[height - 3, width // 2, 0] > 200,
    }
    winners = [name for name, value in samples.items() if value]
    assert winners == [next(name for name, value in samples.items() if value)]
    return winners[0]


def test_apply_rotation_moves_left_bar_to_bottom():
    image = np.zeros((40, 80, 3), dtype=np.uint8)
    image[:, :10] = 255
    rotated = apply_display_rotation(image, 90)
    assert white_edge(rotated) == "bottom"
