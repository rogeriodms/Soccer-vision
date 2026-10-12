from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from app.errors import VideoUnreadable
from app.models.detections import Detection
from app.services.paths import relative_to_root
from app.services.probe import probe_video
from app.services.sampling import select_sample_indices
from app.services.timestamps import assign_timestamps, gap_threshold_ms
from app.tracking.config import write_tracker_config
from app.video.annotate import mux_original_audio, write_silent_video
from app.video.decode import iter_bgr_frames, read_presentation_clock

PERSON_CLASS_NOTE = (
    "A detecção usa a classe pessoa do COCO. Árbitros, comissão técnica, gandulas e espectadores "
    "também podem gerar tracks."
)


class FrameTracker(Protocol):
    def reset(self) -> None: ...

    def track(self, frame_bgr, *, confidence: float, tracker_yaml: Path) -> list[Detection]: ...


def analyze_video(
    *,
    video_path: Path,
    output_dir: Path,
    storage_root: Path,
    sample_fps: float,
    confidence_threshold: float,
    tracker_name: str,
    generate_annotated_video: bool,
    model_name: str,
    model_sha256: str | None,
    device: str,
    ffmpeg_path: str,
    ffprobe_path: str,
    track_buffer_seconds: float,
    gap_factor: float,
    gmc_method: str,
    tracker: FrameTracker,
    progress: Callable[[str, int], None] | None = None,
    max_observations: int = 2_000_000,
) -> dict:
    def report(stage: str, value: int) -> None:
        if progress is not None:
            progress(stage, max(0, min(100, value)))

    output_dir.mkdir(parents=True, exist_ok=True)
    report("probing", 5)
    metadata = probe_video(video_path, ffprobe_path)
    report("reading_timestamps", 10)
    clocks = read_presentation_clock(video_path)
    timestamps, timestamp_method, uncertainty_ms, warnings = assign_timestamps(clocks, metadata["nominalFps"])
    if not timestamps:
        raise VideoUnreadable("O vídeo não tem frames decodificáveis.")
    if metadata["rotationDegrees"]:
        warnings.append(
            f"Rotação de exibição de {metadata['rotationDegrees']} graus aplicada antes da detecção."
        )
    if metadata["rotationWarning"]:
        warnings.append(metadata["rotationWarning"])
    last_timestamp = timestamps[-1]
    if abs(last_timestamp - metadata["durationMs"]) > max(uncertainty_ms * 4, int(2000 / metadata["nominalFps"])):
        warnings.append(
            "O último PTS e a duração informada pelo container diferem. "
            "A duração do arquivo e os timestamps das detecções podem não coincidir exatamente."
        )
    selected = select_sample_indices(timestamps, sample_fps)
    selected_set = set(selected)
    tracker_yaml = output_dir / "tracker.yaml"
    tracker_config = write_tracker_config(
        tracker_yaml,
        tracker_name,
        sample_fps,
        track_buffer_seconds,
        gmc_method,
    )
    tracker.reset()
    annotations: dict[int, list[Detection]] = {}
    observations: list[dict] = []
    processed = 0
    seen = 0
    report("detecting", 15)
    for index, image in iter_bgr_frames(video_path, metadata["rotationDegrees"]):
        seen += 1
        if index >= len(timestamps):
            raise VideoUnreadable("A segunda leitura do vídeo não bate com a primeira.")
        if index not in selected_set:
            continue
        detections = tracker.track(
            image,
            confidence=confidence_threshold,
            tracker_yaml=tracker_yaml,
        )
        annotations[index] = detections
        timestamp_ms = timestamps[index]
        for detection in detections:
            if detection.confidence + 1e-9 < confidence_threshold:
                continue
            observations.append(
                {
                    "trackerId": detection.tracker_id,
                    "frameNumber": index,
                    "timestampMs": timestamp_ms,
                    "x1": detection.x1,
                    "y1": detection.y1,
                    "x2": detection.x2,
                    "y2": detection.y2,
                    "confidence": detection.confidence,
                }
            )
        processed += 1
        if processed == len(selected) or processed % 5 == 0:
            report("detecting", 15 + int(65 * processed / max(len(selected), 1)))
    if seen != len(timestamps):
        raise VideoUnreadable("A segunda leitura do vídeo não bate com a primeira.")
    if len(observations) > max_observations:
        raise VideoUnreadable(
            f"A análise gerou {len(observations)} observações, acima do limite de {max_observations}."
        )

    audio_preserved: bool | None = None
    audio_note: str | None = None
    annotated_path: Path | None = None
    if generate_annotated_video:
        report("annotating", 82)
        warnings.append(
            "O vídeo anotado usa taxa constante igual ao FPS médio e preserva a contagem de frames. "
            "Em vídeo com FPS variável pode haver pequeno desvio de duração."
        )
        silent_path = output_dir / "annotated.silent.mp4"
        final_path = output_dir / "annotated.mp4"

        def annotated_frames():
            written = 0
            for index, image in iter_bgr_frames(video_path, metadata["rotationDegrees"]):
                if index >= len(timestamps):
                    raise VideoUnreadable("A leitura para anotação não bate com a primeira.")
                written_local = written
                yield image, timestamps[index], annotations.get(index, []), index in selected_set
                written = written_local + 1
                if written % 30 == 0:
                    report("annotating", min(96, 82 + int(14 * written / len(timestamps))))
            if written != len(timestamps):
                raise VideoUnreadable("A leitura para anotação não bate com a primeira.")

        write_silent_video(annotated_frames(), silent_path, metadata["nominalFps"])
        if metadata["hasAudio"]:
            if mux_original_audio(ffmpeg_path, silent_path, video_path, final_path):
                silent_path.unlink(missing_ok=True)
                audio_preserved = True
                audio_note = "O áudio original foi copiado para o vídeo anotado."
            else:
                silent_path.replace(final_path)
                audio_preserved = False
                audio_note = "Não foi possível preservar o áudio. O vídeo anotado contém apenas imagem."
        else:
            silent_path.replace(final_path)
            audio_preserved = False
            audio_note = "O arquivo original não tem faixa de áudio."
        annotated_path = final_path
        warnings.append(audio_note)

    warnings.append(PERSON_CLASS_NOTE)
    samples_path = output_dir / "samples.jsonl"
    observations_path = output_dir / "observations.jsonl"
    metadata_path = output_dir / "run_metadata.json"
    _write_jsonl(
        samples_path,
        [{"frameNumber": index, "timestampMs": timestamps[index]} for index in selected],
    )
    _write_jsonl(observations_path, observations)
    summary = {
        "modelName": model_name,
        "modelSha256": model_sha256,
        "trackerName": tracker_name,
        "device": device,
        "timestampMethod": timestamp_method,
        "timestampUncertaintyMs": uncertainty_ms,
        "sampledFrameCount": len(selected),
        "frameCount": len(timestamps),
        "durationMs": metadata["durationMs"],
        "width": metadata["width"],
        "height": metadata["height"],
        "rotationDegrees": metadata["rotationDegrees"],
        "sampleFps": sample_fps,
        "confidenceThreshold": confidence_threshold,
        "gapThresholdMs": gap_threshold_ms(sample_fps, gap_factor),
        "audioPreserved": audio_preserved,
        "audioNote": audio_note,
        "warnings": warnings,
        "observationsFile": relative_to_root(storage_root, observations_path),
        "samplesFile": relative_to_root(storage_root, samples_path),
        "annotatedVideoFile": None if annotated_path is None else relative_to_root(storage_root, annotated_path),
        "metadataFile": relative_to_root(storage_root, metadata_path),
        "trackerConfig": tracker_config,
        "personClassNote": PERSON_CLASS_NOTE,
    }
    metadata_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    report("completed", 100)
    return summary


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")
