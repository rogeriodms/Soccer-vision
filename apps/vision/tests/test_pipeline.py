import json
import subprocess

from app.models.detections import Detection
from app.services.pipeline import analyze_video


class FakeTracker:
    def __init__(self) -> None:
        self.calls = 0

    def reset(self) -> None:
        self.calls = 0

    def track(self, frame_bgr, *, confidence: float, tracker_yaml):
        assert tracker_yaml.is_file()
        self.calls += 1
        return [Detection(1, 2, 3, 20, 30, 0.91)]


def test_pipeline_uses_decoder_timestamps_and_preserves_audio(tmp_path):
    storage = tmp_path / "storage"
    video = storage / "uploads" / "clip.mp4"
    video.parent.mkdir(parents=True)
    subprocess.check_call([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=160x120:rate=30:duration=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", "-shortest",
        str(video),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    output = storage / "results" / "job"
    tracker = FakeTracker()
    summary = analyze_video(
        video_path=video,
        output_dir=output,
        storage_root=storage,
        sample_fps=3,
        confidence_threshold=0.25,
        tracker_name="botsort",
        generate_annotated_video=True,
        model_name="fake",
        model_sha256=None,
        device="cpu",
        ffmpeg_path="ffmpeg",
        ffprobe_path="ffprobe",
        track_buffer_seconds=3,
        gap_factor=2,
        gmc_method="none",
        tracker=tracker,
    )
    assert summary["timestampMethod"] == "decoder_pts"
    assert summary["sampledFrameCount"] == tracker.calls
    assert tracker.calls >= 3
    observations = [
        json.loads(line)
        for line in (output / "observations.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    assert len(observations) == summary["sampledFrameCount"]
    timestamps = [row["timestampMs"] for row in observations]
    assert timestamps == sorted(timestamps)
    assert timestamps[-1] <= summary["durationMs"] + summary["timestampUncertaintyMs"]
    assert not any(".." in value for value in (summary["observationsFile"], summary["annotatedVideoFile"]))
    probe = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output / "annotated.mp4"),
    ])
    streams = json.loads(probe)["streams"]
    assert any(stream["codec_type"] == "audio" for stream in streams)
    assert summary["audioPreserved"] is True
