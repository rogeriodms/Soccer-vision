import subprocess
import urllib.request
from pathlib import Path

import pytest

from app.config import repo_root
from app.models.detector import YoloPersonTracker
from app.services.pipeline import analyze_video

pytestmark = pytest.mark.integration


def test_yolo_tracks_people_on_a_real_image_sequence(tmp_path):
    model = repo_root() / "models" / "yolo11n.pt"
    if not model.is_file():
        pytest.skip("Pesos yolo11n.pt ausentes. Execute python3 scripts/download_yolo_weights.py.")
    image = tmp_path / "bus.jpg"
    try:
        urllib.request.urlretrieve("https://ultralytics.com/images/bus.jpg", image)
    except Exception as exc:
        pytest.skip(f"Não foi possível baixar a imagem pública de teste: {exc}")
    video = tmp_path / "storage" / "uploads" / "bus.mp4"
    video.parent.mkdir(parents=True)
    subprocess.check_call([
        "ffmpeg", "-y", "-loop", "1", "-i", str(image), "-t", "1", "-r", "10",
        "-pix_fmt", "yuv420p", "-c:v", "libx264", str(video),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tracker = YoloPersonTracker(model, "cpu")
    summary = analyze_video(
        video_path=video,
        output_dir=tmp_path / "storage" / "results" / "job",
        storage_root=tmp_path / "storage",
        sample_fps=5,
        confidence_threshold=0.25,
        tracker_name="botsort",
        generate_annotated_video=True,
        model_name=model.name,
        model_sha256=None,
        device="cpu",
        ffmpeg_path="ffmpeg",
        ffprobe_path="ffprobe",
        track_buffer_seconds=3,
        gap_factor=2,
        gmc_method="sparseOptFlow",
        tracker=tracker,
    )
    assert summary["modelName"] == "yolo11n.pt"
    assert summary["sampledFrameCount"] >= 1
    assert Path(tmp_path / "storage" / summary["annotatedVideoFile"]).is_file()
    observations = (tmp_path / "storage" / summary["observationsFile"]).read_text(encoding="utf-8").strip().splitlines()
    assert observations, "YOLO não detectou pessoas na imagem pública bus.jpg; o resultado não foi inventado."
    import json
    parsed = [json.loads(line) for line in observations]
    assert all(row["confidence"] >= 0.25 for row in parsed)
    assert all(row["timestampMs"] >= 0 for row in parsed)
