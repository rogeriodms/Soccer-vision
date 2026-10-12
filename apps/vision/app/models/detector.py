from __future__ import annotations

from pathlib import Path

from app.models.detections import PERSON_CLASS_ID, Detection


class YoloPersonTracker:
    """Rastreador persistente. Os frames precisam ser enviados em ordem.

    O estado fica no predictor do Ultralytics. `reset()` zera os tracks entre vídeos.
    """

    def __init__(self, model_path: Path, device: str) -> None:
        from ultralytics import YOLO

        self.model_path = model_path
        self.device = device
        self.model = YOLO(str(model_path))

    def reset(self) -> None:
        predictor = getattr(self.model, "predictor", None)
        if predictor is not None:
            predictor.trackers = []

    def track(self, frame_bgr, *, confidence: float, tracker_yaml: Path) -> list[Detection]:
        results = self.model.track(
            source=frame_bgr,
            persist=True,
            tracker=str(tracker_yaml),
            classes=[PERSON_CLASS_ID],
            conf=confidence,
            device=self.device,
            verbose=False,
        )
        result = results[0]
        boxes = result.boxes
        if boxes is None or boxes.id is None:
            return []
        ids = boxes.id.detach().cpu().numpy()
        xyxy = boxes.xyxy.detach().cpu().numpy()
        confidences = boxes.conf.detach().cpu().numpy()
        classes = boxes.cls.detach().cpu().numpy()
        detections: list[Detection] = []
        for index in range(len(ids)):
            if int(classes[index]) != PERSON_CLASS_ID:
                continue
            x1, y1, x2, y2 = (float(value) for value in xyxy[index])
            if x2 < x1:
                x1, x2 = x2, x1
            if y2 < y1:
                y1, y2 = y2, y1
            score = min(1.0, max(0.0, float(confidences[index])))
            detections.append(
                Detection(
                    tracker_id=int(ids[index]),
                    x1=round(x1, 2),
                    y1=round(y1, 2),
                    x2=round(x2, 2),
                    y2=round(y2, 2),
                    confidence=round(score, 6),
                )
            )
        return detections
