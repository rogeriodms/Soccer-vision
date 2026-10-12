import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";
import {
  DETECTION_RATIO_EXPLANATION,
  GAP_DEFINITION,
  METRICS_DISCLAIMER,
  PERSON_CLASS_NOTE,
  gapThresholdMs,
} from "@football-vision/shared";
import { AppError } from "../lib/errors.js";
import { resolveInside } from "../lib/paths.js";
import { buildTracks, type ComputedTrack } from "../lib/stats.js";
import { validateTimestampSeries } from "../lib/timestamps.js";
import type { PublicSummary } from "../repositories/types.js";
import {
  observationLineSchema,
  sampleLineSchema,
  type AnalysisConfig,
  type VisionSummary,
} from "../schemas/http.js";

export async function readJsonl(filePath: string, maxLines: number): Promise<unknown[]> {
  const rows: unknown[] = [];
  const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new AppError(422, "RESULT_MISMATCH", "O serviço de visão devolveu um JSONL inválido.");
    }
    if (rows.length > maxLines) {
      throw new AppError(422, "TOO_MANY_OBSERVATIONS", "A análise gerou observações demais para o limite configurado.");
    }
  }
  return rows;
}

export async function importVisionResult(input: {
  summary: VisionSummary;
  storageRoot: string;
  expected: AnalysisConfig;
  gapFactor: number;
  maxObservations: number;
}): Promise<{ tracks: ComputedTrack[]; summary: PublicSummary; artifacts: PublicSummaryArtifact[] }> {
  const summary = input.summary;
  if (Math.abs(summary.sampleFps - input.expected.sampleFps) > 1e-6) {
    throw new AppError(422, "RESULT_MISMATCH", "O sampleFps do resultado não confere com o pedido.");
  }
  if (summary.trackerName !== input.expected.tracker) {
    throw new AppError(422, "RESULT_MISMATCH", "O rastreador do resultado não confere com o pedido.");
  }
  if (Math.abs(summary.confidenceThreshold - input.expected.confidenceThreshold) > 1e-6) {
    throw new AppError(422, "RESULT_MISMATCH", "O limiar de confiança do resultado não confere com o pedido.");
  }
  const expectedGap = gapThresholdMs(summary.sampleFps, input.gapFactor);
  if (Math.abs(expectedGap - summary.gapThresholdMs) > 0.05) {
    throw new AppError(422, "RESULT_MISMATCH", "O limiar de lacunas do resultado não confere com a fórmula documentada.");
  }
  const samplesPath = resolveInside(input.storageRoot, summary.samplesFile);
  const observationsPath = resolveInside(input.storageRoot, summary.observationsFile);
  const metadataPath = resolveInside(input.storageRoot, summary.metadataFile);
  const sampleRows = await readJsonl(samplesPath, summary.frameCount + 1);
  const observationRows = await readJsonl(observationsPath, input.maxObservations);
  const samples = sampleRows.map((row, index) => {
    const parsed = sampleLineSchema.safeParse(row);
    if (!parsed.success) {
      throw new AppError(422, "RESULT_MISMATCH", `Amostra inválida na linha ${index + 1}.`);
    }
    return parsed.data;
  });
  if (samples.length !== summary.sampledFrameCount) {
    throw new AppError(422, "RESULT_MISMATCH", "A quantidade de frames amostrados não confere.");
  }
  const framePeriod = summary.frameCount > 0 ? summary.durationMs / summary.frameCount : 0;
  const tolerance = Math.max(summary.timestampUncertaintyMs, Math.ceil(framePeriod));
  const timestampIssues = validateTimestampSeries(samples, summary.durationMs, tolerance);
  if (timestampIssues.length > 0) {
    throw new AppError(422, "TIMESTAMP_INCOHERENT", "Os timestamps produzidos não passaram na validação.");
  }
  const sampleTimestamps = new Map(samples.map((sample) => [sample.frameNumber, sample.timestampMs]));
  const observations = observationRows.map((row, index) => {
    const parsed = observationLineSchema.safeParse(row);
    if (!parsed.success) {
      throw new AppError(422, "RESULT_MISMATCH", `Observação inválida na linha ${index + 1}.`);
    }
    const expectedTimestamp = sampleTimestamps.get(parsed.data.frameNumber);
    if (expectedTimestamp === undefined || expectedTimestamp !== parsed.data.timestampMs) {
      throw new AppError(422, "TIMESTAMP_INCOHERENT", "Uma observação não corresponde ao timestamp do frame amostrado.");
    }
    if (parsed.data.confidence + 1e-6 < summary.confidenceThreshold) {
      throw new AppError(422, "RESULT_MISMATCH", "Há uma observação abaixo do limiar de confiança.");
    }
    if (
      parsed.data.x1 < -50 ||
      parsed.data.y1 < -50 ||
      parsed.data.x2 > summary.width + 50 ||
      parsed.data.y2 > summary.height + 50
    ) {
      throw new AppError(422, "RESULT_MISMATCH", "Há uma bounding box fora dos limites do quadro.");
    }
    return parsed.data;
  });
  const tracks = buildTracks(observations, summary.sampledFrameCount, summary.gapThresholdMs);
  const artifacts: PublicSummaryArtifact[] = [];
  const metadataStat = await stat(metadataPath);
  artifacts.push({
    kind: "run_metadata",
    relativePath: summary.metadataFile,
    mimeType: "application/json",
    sizeBytes: metadataStat.size,
  });
  if (input.expected.generateAnnotatedVideo) {
    if (!summary.annotatedVideoFile) {
      throw new AppError(422, "RESULT_MISMATCH", "O vídeo anotado foi pedido e não foi produzido.");
    }
    const annotatedPath = resolveInside(input.storageRoot, summary.annotatedVideoFile);
    const annotatedStat = await stat(annotatedPath);
    if (annotatedStat.size <= 0) {
      throw new AppError(422, "RESULT_MISMATCH", "O vídeo anotado está vazio.");
    }
    artifacts.push({
      kind: "annotated_video",
      relativePath: summary.annotatedVideoFile,
      mimeType: "video/mp4",
      sizeBytes: annotatedStat.size,
    });
  }
  return {
    tracks,
    artifacts,
    summary: {
      timestampMethod: summary.timestampMethod,
      timestampUncertaintyMs: summary.timestampUncertaintyMs,
      sampledFrameCount: summary.sampledFrameCount,
      frameCount: summary.frameCount,
      durationMs: summary.durationMs,
      width: summary.width,
      height: summary.height,
      rotationDegrees: summary.rotationDegrees,
      sampleFps: summary.sampleFps,
      confidenceThreshold: summary.confidenceThreshold,
      gapThresholdMs: summary.gapThresholdMs,
      gapDefinition: GAP_DEFINITION,
      detectionRatioDenominator: "sampled_frames",
      detectionRatioExplanation: DETECTION_RATIO_EXPLANATION,
      audioPreserved: summary.audioPreserved,
      audioNote: summary.audioNote,
      modelName: summary.modelName,
      modelSha256: summary.modelSha256,
      trackerName: summary.trackerName,
      trackerConfig: summary.trackerConfig,
      device: summary.device,
      warnings: summary.warnings,
      metricsArePreliminary: true,
      personClassNote: summary.personClassNote || PERSON_CLASS_NOTE,
      metricsDisclaimer: METRICS_DISCLAIMER,
    },
  };
}

export interface PublicSummaryArtifact {
  kind: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
}
