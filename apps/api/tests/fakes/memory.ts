import { randomUUID } from "node:crypto";
import { paginate } from "../../src/lib/pagination.js";
import type { Page } from "../../src/lib/pagination.js";
import type {
  AnalysisRecord,
  AnalysisRepository,
  ArtifactRecord,
  ObservationRecord,
  SaveResultsInput,
  TrackRecord,
  VideoRecord,
  VideoRepository,
} from "../../src/repositories/types.js";
import type { TrackQuery } from "../../src/schemas/http.js";

const STALE_MESSAGE = "O processamento expirou após o número máximo de tentativas.";

export class MemoryVideos implements VideoRepository {
  readonly items = new Map<string, VideoRecord>();

  async create(video: VideoRecord): Promise<VideoRecord> {
    this.items.set(video.id, video);
    return video;
  }

  async findById(id: string): Promise<VideoRecord | null> {
    return this.items.get(id) ?? null;
  }
}

export class MemoryAnalyses implements AnalysisRepository {
  readonly items = new Map<string, AnalysisRecord>();
  readonly tracks = new Map<string, TrackRecord & { observations: ObservationRecord[] }>();
  readonly artifacts = new Map<string, ArtifactRecord>();

  async create(input: {
    id: string;
    videoId: string;
    configuration: AnalysisRecord["configuration"];
    now: Date;
  }): Promise<AnalysisRecord> {
    const record: AnalysisRecord = {
      id: input.id,
      videoId: input.videoId,
      status: "queued",
      progress: 0,
      currentStage: "queued",
      modelName: null,
      trackerName: null,
      configuration: input.configuration,
      resultSummary: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      attemptCount: 0,
      claimToken: null,
      claimedAt: null,
      availableAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.items.set(record.id, record);
    return structuredClone(record);
  }

  async findById(id: string): Promise<AnalysisRecord | null> {
    const record = this.items.get(id);
    return record ? structuredClone(record) : null;
  }

  async claimNext(input: {
    token: string;
    staleSeconds: number;
    maxAttempts: number;
    now: Date;
  }): Promise<AnalysisRecord | null> {
    const staleBefore = input.now.getTime() - input.staleSeconds * 1000;
    for (const analysis of this.items.values()) {
      if (
        analysis.status === "processing" &&
        analysis.claimedAt &&
        analysis.claimedAt.getTime() < staleBefore &&
        analysis.attemptCount >= input.maxAttempts
      ) {
        analysis.status = "failed";
        analysis.errorCode = "STALE_CLAIM";
        analysis.errorMessage = STALE_MESSAGE;
        analysis.completedAt = input.now;
        analysis.currentStage = "failed";
        analysis.claimToken = null;
        analysis.updatedAt = input.now;
      }
    }
    const selected = [...this.items.values()]
      .filter((analysis) => {
        if (analysis.status === "queued" && analysis.availableAt.getTime() <= input.now.getTime()) {
          return true;
        }
        return (
          analysis.status === "processing" &&
          analysis.claimedAt !== null &&
          analysis.claimedAt.getTime() < staleBefore &&
          analysis.attemptCount < input.maxAttempts
        );
      })
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
    if (!selected) {
      return null;
    }
    selected.status = "processing";
    selected.claimToken = input.token;
    selected.claimedAt = input.now;
    selected.startedAt ??= input.now;
    selected.attemptCount += 1;
    selected.currentStage = "claimed";
    selected.progress = Math.max(selected.progress, 1);
    selected.updatedAt = input.now;
    return structuredClone(selected);
  }

  async updateProgress(id: string, token: string, progress: number, stage: string): Promise<void> {
    const analysis = this.owned(id, token);
    if (!analysis) {
      return;
    }
    analysis.progress = Math.max(0, Math.min(99, Math.round(progress)));
    analysis.currentStage = stage;
    analysis.updatedAt = new Date();
  }

  async markRetry(id: string, token: string, errorCode: string, errorMessage: string, availableAt: Date): Promise<boolean> {
    const analysis = this.owned(id, token);
    if (!analysis) {
      return false;
    }
    analysis.status = "queued";
    analysis.errorCode = errorCode;
    analysis.errorMessage = errorMessage;
    analysis.currentStage = "retry_scheduled";
    analysis.claimToken = null;
    analysis.claimedAt = null;
    analysis.availableAt = availableAt;
    analysis.progress = 0;
    analysis.updatedAt = new Date();
    return true;
  }

  async markFailed(id: string, token: string, errorCode: string, errorMessage: string, now: Date): Promise<boolean> {
    const analysis = this.owned(id, token);
    if (!analysis) {
      return false;
    }
    analysis.status = "failed";
    analysis.errorCode = errorCode;
    analysis.errorMessage = errorMessage;
    analysis.completedAt = now;
    analysis.currentStage = "failed";
    analysis.claimToken = null;
    analysis.updatedAt = now;
    return true;
  }

  async saveResults(id: string, token: string, payload: SaveResultsInput, now: Date): Promise<"saved" | "lost_claim"> {
    const analysis = this.owned(id, token);
    if (!analysis) {
      return "lost_claim";
    }
    for (const [key, track] of this.tracks) {
      if (track.analysisId === id) {
        this.tracks.delete(key);
      }
    }
    for (const [key, artifact] of this.artifacts) {
      if (artifact.analysisId === id) {
        this.artifacts.delete(key);
      }
    }
    const seen = new Set<number>();
    for (const track of payload.tracks) {
      if (seen.has(track.trackerId)) {
        throw new Error("tracker duplicado");
      }
      seen.add(track.trackerId);
      const trackId = randomUUID();
      const observations: ObservationRecord[] = [];
      const frames = new Set<number>();
      for (const observation of track.observations) {
        if (frames.has(observation.frameNumber)) {
          throw new Error("observação duplicada");
        }
        frames.add(observation.frameNumber);
        observations.push({
          id: randomUUID(),
          analysisId: id,
          trackId,
          trackerId: observation.trackerId,
          frameNumber: observation.frameNumber,
          timestampMs: observation.timestampMs,
          x1: observation.x1,
          y1: observation.y1,
          x2: observation.x2,
          y2: observation.y2,
          confidence: observation.confidence,
        });
      }
      this.tracks.set(trackId, {
        id: trackId,
        analysisId: id,
        trackerId: track.trackerId,
        firstSeenMs: track.firstSeenMs,
        lastSeenMs: track.lastSeenMs,
        observationCount: track.observationCount,
        observedDurationMs: track.observedDurationMs,
        averageConfidence: track.averageConfidence,
        detectionRatio: track.detectionRatio,
        gapCount: track.gapCount,
        minX1: track.minX1,
        minY1: track.minY1,
        maxX2: track.maxX2,
        maxY2: track.maxY2,
        observations,
      });
    }
    for (const artifact of payload.artifacts) {
      this.artifacts.set(`${id}:${artifact.kind}`, {
        id: randomUUID(),
        analysisId: id,
        kind: artifact.kind,
        relativePath: artifact.relativePath,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: now,
      });
    }
    analysis.status = "completed";
    analysis.progress = 100;
    analysis.currentStage = "completed";
    analysis.completedAt = now;
    analysis.claimToken = null;
    analysis.errorCode = null;
    analysis.errorMessage = null;
    analysis.modelName = payload.modelName;
    analysis.trackerName = payload.trackerName;
    analysis.resultSummary = payload.resultSummary;
    analysis.updatedAt = now;
    return "saved";
  }

  async listTracks(analysisId: string, query: TrackQuery): Promise<Page<TrackRecord>> {
    const tracks = [...this.tracks.values()]
      .filter((track) => track.analysisId === analysisId)
      .sort((left, right) => compare(left, right, query));
    return paginate(tracks.map(({ observations: _observations, ...track }) => track), query);
  }

  async listObservations(analysisId: string, trackerId: number, query: { page: number; pageSize: number }) {
    const track = [...this.tracks.values()].find((item) => item.analysisId === analysisId && item.trackerId === trackerId);
    if (!track) {
      return null;
    }
    const observations = [...track.observations].sort(
      (left, right) => left.timestampMs - right.timestampMs || left.frameNumber - right.frameNumber,
    );
    return paginate(observations, query);
  }

  async listArtifacts(analysisId: string): Promise<ArtifactRecord[]> {
    return [...this.artifacts.values()].filter((artifact) => artifact.analysisId === analysisId);
  }

  async findArtifact(analysisId: string, kind: string): Promise<ArtifactRecord | null> {
    return this.artifacts.get(`${analysisId}:${kind}`) ?? null;
  }

  private owned(id: string, token: string): AnalysisRecord | undefined {
    const analysis = this.items.get(id);
    if (!analysis || analysis.claimToken !== token || analysis.status !== "processing") {
      return undefined;
    }
    return analysis;
  }
}

function compare(left: TrackRecord, right: TrackRecord, query: TrackQuery): number {
  const direction = query.order === "asc" ? 1 : -1;
  const leftValue = left[query.sort];
  const rightValue = right[query.sort];
  if (leftValue < rightValue) {
    return -1 * direction;
  }
  if (leftValue > rightValue) {
    return 1 * direction;
  }
  return left.trackerId - right.trackerId;
}
