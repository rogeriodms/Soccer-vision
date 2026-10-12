import type { AnalysisStatus } from "@football-vision/shared";
import type { ComputedTrack } from "../lib/stats.js";
import type { Page } from "../lib/pagination.js";
import type { AnalysisConfig, TrackQuery } from "../schemas/http.js";

export interface VideoRecord {
  id: string;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  nominalFps: number;
  createdAt: Date;
}

export interface PublicSummary {
  timestampMethod: "decoder_pts" | "nominal_fps_fallback";
  timestampUncertaintyMs: number;
  sampledFrameCount: number;
  frameCount: number;
  durationMs: number;
  width: number;
  height: number;
  rotationDegrees: number;
  sampleFps: number;
  confidenceThreshold: number;
  gapThresholdMs: number;
  gapDefinition: string;
  detectionRatioDenominator: "sampled_frames";
  detectionRatioExplanation: string;
  audioPreserved: boolean | null;
  audioNote: string | null;
  modelName: string;
  modelSha256: string | null;
  trackerName: "botsort" | "bytetrack";
  trackerConfig: Record<string, string | number | boolean>;
  device: string;
  warnings: string[];
  metricsArePreliminary: true;
  personClassNote: string;
  metricsDisclaimer: string;
}

export interface AnalysisRecord {
  id: string;
  videoId: string;
  status: AnalysisStatus;
  progress: number;
  currentStage: string | null;
  modelName: string | null;
  trackerName: string | null;
  configuration: AnalysisConfig;
  resultSummary: PublicSummary | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  attemptCount: number;
  claimToken: string | null;
  claimedAt: Date | null;
  availableAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackRecord {
  id: string;
  analysisId: string;
  trackerId: number;
  firstSeenMs: number;
  lastSeenMs: number;
  observationCount: number;
  observedDurationMs: number;
  averageConfidence: number;
  detectionRatio: number;
  gapCount: number;
  minX1: number;
  minY1: number;
  maxX2: number;
  maxY2: number;
}

export interface ObservationRecord {
  id: string;
  analysisId: string;
  trackId: string;
  trackerId: number;
  frameNumber: number;
  timestampMs: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

export interface ArtifactRecord {
  id: string;
  analysisId: string;
  kind: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface SaveResultsInput {
  modelName: string;
  trackerName: string;
  resultSummary: PublicSummary;
  tracks: ComputedTrack[];
  artifacts: Array<{
    kind: string;
    relativePath: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}

export interface VideoRepository {
  create(video: VideoRecord): Promise<VideoRecord>;
  findById(id: string): Promise<VideoRecord | null>;
}

export interface AnalysisRepository {
  create(input: {
    id: string;
    videoId: string;
    configuration: AnalysisConfig;
    now: Date;
  }): Promise<AnalysisRecord>;
  findById(id: string): Promise<AnalysisRecord | null>;
  claimNext(input: { token: string; staleSeconds: number; maxAttempts: number; now: Date }): Promise<AnalysisRecord | null>;
  updateProgress(id: string, token: string, progress: number, stage: string): Promise<void>;
  markRetry(id: string, token: string, errorCode: string, errorMessage: string, availableAt: Date): Promise<boolean>;
  markFailed(id: string, token: string, errorCode: string, errorMessage: string, now: Date): Promise<boolean>;
  saveResults(id: string, token: string, payload: SaveResultsInput, now: Date): Promise<"saved" | "lost_claim">;
  listTracks(analysisId: string, query: TrackQuery): Promise<Page<TrackRecord>>;
  listObservations(
    analysisId: string,
    trackerId: number,
    query: { page: number; pageSize: number },
  ): Promise<Page<ObservationRecord> | null>;
  listArtifacts(analysisId: string): Promise<ArtifactRecord[]>;
  findArtifact(analysisId: string, kind: string): Promise<ArtifactRecord | null>;
}
