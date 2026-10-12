from fastapi.testclient import TestClient

from app.api.routes import create_app
from app.config import Settings


def test_health_reports_missing_weights(tmp_path):
    settings = Settings(
        storage_root=tmp_path / "storage",
        models_dir=tmp_path / "models",
        yolo_model="yolo11n.pt",
        vision_device="cpu",
    )
    client = TestClient(create_app(settings))
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["modelAvailable"] is False
    assert "download_yolo_weights.py" in body["weightsHelp"]
    assert "status" in body


def test_analyze_refuses_missing_weights_and_path_escape(tmp_path):
    storage = tmp_path / "storage"
    (storage / "uploads").mkdir(parents=True)
    (storage / "uploads" / "clip.mp4").write_bytes(b"not-a-real-video")
    settings = Settings(
        storage_root=storage,
        models_dir=tmp_path / "models",
        yolo_model="yolo11n.pt",
        vision_device="cpu",
    )
    client = TestClient(create_app(settings))
    missing = client.post("/v1/analyze", json={
        "videoPath": "uploads/clip.mp4",
        "outputDir": "results/job",
        "sampleFps": 3,
        "confidenceThreshold": 0.25,
        "tracker": "botsort",
        "generateAnnotatedVideo": False,
    })
    assert missing.status_code == 409
    assert missing.json()["error"] == "MODEL_WEIGHTS_MISSING"
    escaped = client.post("/v1/analyze", json={
        "videoPath": "../../etc/passwd",
        "outputDir": "results/job",
        "sampleFps": 3,
        "confidenceThreshold": 0.25,
        "tracker": "botsort",
        "generateAnnotatedVideo": False,
    })
    assert escaped.status_code == 400
    assert escaped.json()["error"] == "INVALID_PATH"
