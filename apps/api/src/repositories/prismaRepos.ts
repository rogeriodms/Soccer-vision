import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppError } from "../lib/errors.js";
import type { Page } from "../lib/pagination.js";
import { analysisConfigSchema, type TrackQuery } from "../schemas/http.js";
import type {
  AnalysisRecord,
  AnalysisRepository,
  ArtifactRecord,
  ObservationRecord,
  PublicSummary,
  SaveResultsInput,
  TrackRecord,
  VideoRecord,
  VideoRepository,
} from "./types.js";

const STALE_MESSAGE = "O processamento expirou após o número máximo de tentativas.";

export function createPrismaVideoRepository(prisma: PrismaClient): VideoRepository {
  return {
    async create(video) {
      const created = await prisma.video.create({
        data: {
          id: video.id,
          originalName: video.originalName,
          storagePath: video.storagePath,
          mimeType: video.mimeType,
          sizeBytes: BigInt(video.sizeBytes),
          durationMs: video.durationMs,
          width: video.width,
          height: video.height,
          nominalFps: video.nominalFps,
          createdAt: video.createdAt,
        },
      });
      return mapVideo(created);
    },
    async findById(id) {
      const video = await prisma.video.findUnique({ where: { id } });
      return video ? mapVideo(video) : null;
    },
  };
}

export function createPrismaAnalysisRepository(prisma: PrismaClient): AnalysisRepository {
  return {
    async create(input) {
      const created = await prisma.analysis.create({
        data: {
          id: input.id,
          videoId: input.videoId,
          status: "queued",
          progress: 0,
          currentStage: "queued",
          configuration: input.configuration,
          availableAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return mapAnalysis(created);
    },
    async findById(id) {
      const analysis = await prisma.analysis.findUnique({ where: { id } });
      return analysis ? mapAnalysis(analysis) : null;
    },
    async claimNext(input) {
      const staleBefore = new Date(input.now.getTime() - input.staleSeconds * 1000);
      await prisma.$executeRaw`
        UPDATE analyses
        SET status = 'failed',
            error_code = 'STALE_CLAIM',
            error_message = ${STALE_MESSAGE},
            completed_at = ${input.now},
            current_stage = 'failed',
            claim_token = NULL,
            updated_at = ${input.now}
        WHERE status::text = 'processing'
          AND claimed_at IS NOT NULL
          AND claimed_at < ${staleBefore}
          AND attempt_count >= ${input.maxAttempts}
      `;
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE analyses AS a
        SET status = 'processing',
            claimed_at = ${input.now},
            claim_token = ${input.token},
            started_at = COALESCE(a.started_at, ${input.now}),
            attempt_count = a.attempt_count + 1,
            current_stage = 'claimed',
            progress = GREATEST(a.progress, 1),
            updated_at = ${input.now}
        WHERE a.id = (
          SELECT id FROM analyses
          WHERE (
            status::text = 'queued'
            AND available_at <= ${input.now}
          ) OR (
            status::text = 'processing'
            AND claimed_at IS NOT NULL
            AND claimed_at < ${staleBefore}
            AND attempt_count < ${input.maxAttempts}
          )
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING a.id
      `;
      const id = rows[0]?.id;
      if (!id) {
        return null;
      }
      const analysis = await prisma.analysis.findUnique({ where: { id } });
      return analysis ? mapAnalysis(analysis) : null;
    },
    async updateProgress(id, token, progress, stage) {
      await prisma.analysis.updateMany({
        where: { id, claimToken: token, status: "processing" },
        data: { progress: Math.max(0, Math.min(99, Math.round(progress))), currentStage: stage },
      });
    },
    async markRetry(id, token, errorCode, errorMessage, availableAt) {
      const result = await prisma.analysis.updateMany({
        where: { id, claimToken: token, status: "processing" },
        data: {
          status: "queued",
          errorCode,
          errorMessage,
          currentStage: "retry_scheduled",
          claimToken: null,
          claimedAt: null,
          availableAt,
          progress: 0,
        },
      });
      return result.count > 0;
    },
    async markFailed(id, token, errorCode, errorMessage, now) {
      const result = await prisma.analysis.updateMany({
        where: { id, claimToken: token, status: "processing" },
        data: {
          status: "failed",
          errorCode,
          errorMessage,
          completedAt: now,
          currentStage: "failed",
          claimToken: null,
        },
      });
      return result.count > 0;
    },
    async saveResults(id, token, payload, now) {
      return prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM analyses
          WHERE id = CAST(${id} AS uuid)
            AND claim_token = ${token}
            AND status::text = 'processing'
          FOR UPDATE
        `;
        if (locked.length === 0) {
          return "lost_claim" as const;
        }
        await tx.trackObservation.deleteMany({ where: { analysisId: id } });
        await tx.track.deleteMany({ where: { analysisId: id } });
        await tx.artifact.deleteMany({ where: { analysisId: id } });
        for (const track of payload.tracks) {
          const trackId = randomUUID();
          await tx.track.create({
            data: {
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
            },
          });
          for (const chunk of chunks(track.observations, 1000)) {
            await tx.trackObservation.createMany({
              data: chunk.map((observation) => ({
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
              })),
            });
          }
        }
        if (payload.artifacts.length > 0) {
          await tx.artifact.createMany({
            data: payload.artifacts.map((artifact) => ({
              analysisId: id,
              kind: artifact.kind,
              relativePath: artifact.relativePath,
              mimeType: artifact.mimeType,
              sizeBytes: BigInt(artifact.sizeBytes),
            })),
          });
        }
        await tx.analysis.update({
          where: { id },
          data: {
            status: "completed",
            progress: 100,
            currentStage: "completed",
            completedAt: now,
            claimToken: null,
            errorCode: null,
            errorMessage: null,
            modelName: payload.modelName,
            trackerName: payload.trackerName,
            resultSummary: payload.resultSummary as unknown as Prisma.InputJsonValue,
          },
        });
        return "saved" as const;
      }, { timeout: 120_000, maxWait: 10_000 });
    },
    async listTracks(analysisId, query) {
      const where = { analysisId };
      const [total, rows] = await prisma.$transaction([
        prisma.track.count({ where }),
        prisma.track.findMany({
          where,
          orderBy: trackOrder(query),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return page(rows.map(mapTrack), query.page, query.pageSize, total);
    },
    async listObservations(analysisId, trackerId, query) {
      const track = await prisma.track.findUnique({
        where: { analysisId_trackerId: { analysisId, trackerId } },
      });
      if (!track) {
        return null;
      }
      const where = { analysisId, trackId: track.id };
      const [total, rows] = await prisma.$transaction([
        prisma.trackObservation.count({ where }),
        prisma.trackObservation.findMany({
          where,
          orderBy: [{ timestampMs: "asc" }, { frameNumber: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return page(rows.map(mapObservation), query.page, query.pageSize, total);
    },
    async listArtifacts(analysisId) {
      const rows = await prisma.artifact.findMany({ where: { analysisId }, orderBy: { kind: "asc" } });
      return rows.map(mapArtifact);
    },
    async findArtifact(analysisId, kind) {
      const row = await prisma.artifact.findUnique({ where: { analysisId_kind: { analysisId, kind } } });
      return row ? mapArtifact(row) : null;
    },
  };
}

function mapVideo(video: {
  id: string;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: bigint;
  durationMs: number;
  width: number;
  height: number;
  nominalFps: number;
  createdAt: Date;
}): VideoRecord {
  return { ...video, sizeBytes: Number(video.sizeBytes) };
}

function mapAnalysis(analysis: {
  id: string;
  videoId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  currentStage: string | null;
  modelName: string | null;
  trackerName: string | null;
  configuration: Prisma.JsonValue;
  resultSummary: Prisma.JsonValue | null;
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
}): AnalysisRecord {
  return {
    ...analysis,
    configuration: analysisConfigSchema.parse(analysis.configuration),
    resultSummary: asSummary(analysis.resultSummary),
  };
}

function asSummary(value: Prisma.JsonValue | null): PublicSummary | null {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(500, "internal_error", "Resumo da análise está corrompido.");
  }
  return value as unknown as PublicSummary;
}

function mapTrack(track: TrackRecord): TrackRecord {
  return track;
}

function mapObservation(observation: ObservationRecord): ObservationRecord {
  return observation;
}

function mapArtifact(artifact: {
  id: string;
  analysisId: string;
  kind: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: bigint;
  createdAt: Date;
}): ArtifactRecord {
  return { ...artifact, sizeBytes: Number(artifact.sizeBytes) };
}

function page<T>(items: T[], pageNumber: number, pageSize: number, total: number): Page<T> {
  return {
    items,
    page: pageNumber,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function trackOrder(query: TrackQuery): Prisma.TrackOrderByWithRelationInput[] {
  const direction = query.order;
  const primary: Prisma.TrackOrderByWithRelationInput = { [query.sort]: direction };
  return [primary, { trackerId: "asc" }];
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}
