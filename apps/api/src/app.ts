import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppConfig } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { resolveInside, sanitizeOriginalName } from "./lib/paths.js";
import type { ProbeResult } from "./lib/media.js";
import type { AnalysisRepository, VideoRepository } from "./repositories/types.js";
import { analysisConfigSchema, errorSchema, pageQuerySchema, trackQuerySchema } from "./schemas/http.js";
import { requireAnalysis, requireCompleted } from "./services/analysisQuery.js";
import { ingestVideo } from "./services/videoService.js";
import type { VisionHealth } from "./services/visionHealth.js";

export interface HttpDeps {
  config: AppConfig;
  videos: VideoRepository;
  analyses: AnalysisRepository;
  probe: (filePath: string) => Promise<ProbeResult>;
  decodeCheck: (filePath: string) => Promise<void>;
  visionHealth: () => Promise<VisionHealth>;
  databaseCheck: () => Promise<boolean>;
  ffmpegAvailable: () => Promise<boolean>;
  logger?: boolean;
}

const iso = z.string().datetime();

const analysisResponseSchema = z.object({
  analysisId: z.string().uuid(),
  videoId: z.string().uuid(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  progress: z.number().int(),
  currentStage: z.string().nullable(),
  modelName: z.string().nullable(),
  trackerName: z.string().nullable(),
  configuration: analysisConfigSchema,
  resultSummary: z.unknown().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attemptCount: z.number().int(),
  startedAt: iso.nullable(),
  completedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
  links: z.object({
    self: z.string(),
    tracks: z.string(),
    artifacts: z.string(),
  }),
});

export async function buildApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger === false ? false : { level: deps.config.logLevel },
    bodyLimit: deps.config.maxUploadBytes + 1024 * 1024,
    trustProxy: false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Football Vision API",
        version: "0.1.0",
        description:
          "MVP local para detectar e rastrear pessoas em vídeo de futebol. Não há autenticação. Não exponha este serviço em rede pública.",
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await app.register(multipart, {
    limits: { fileSize: deps.config.maxUploadBytes, files: 1, fields: 2 },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const statusCode = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
    const code = error instanceof AppError
      ? error.code
      : typeof error === "object" && error && "code" in error && typeof error.code === "string"
        ? error.code
        : "bad_request";
    const message = error instanceof Error ? error.message : "Requisição inválida.";
    request.log.error({ err: error }, "falha na requisição");
    if (code === "FST_REQ_FILE_TOO_LARGE" || statusCode === 413) {
      return reply.status(413).send({
        error: "file_too_large",
        message: `O arquivo excede o limite de ${deps.config.maxUploadBytes} bytes.`,
      });
    }
    if (statusCode >= 500) {
      return reply.status(statusCode).send({ error: "internal_error", message: "Erro interno." });
    }
    return reply.status(statusCode).send({
      error: code,
      message: message || "Requisição inválida.",
    });
  });

  app.get("/health", {
    schema: {
      response: {
        200: z.object({
          status: z.enum(["ok", "degraded"]),
          service: z.literal("api"),
          dependencies: z.object({
            database: z.enum(["ok", "error"]),
            ffmpeg: z.enum(["ok", "missing"]),
            storage: z.enum(["ok", "error"]),
          }),
        }),
      },
    },
  }, async () => {
    const [database, ffmpeg, storage] = await Promise.all([
      deps.databaseCheck(),
      deps.ffmpegAvailable(),
      storageReady(deps.config.storageRoot),
    ]);
    const healthy = database && ffmpeg && storage;
    const status: "ok" | "degraded" = healthy ? "ok" : "degraded";
    const databaseStatus: "ok" | "error" = database ? "ok" : "error";
    const ffmpegStatus: "ok" | "missing" = ffmpeg ? "ok" : "missing";
    const storageStatus: "ok" | "error" = storage ? "ok" : "error";
    return {
      status,
      service: "api" as const,
      dependencies: {
        database: databaseStatus,
        ffmpeg: ffmpegStatus,
        storage: storageStatus,
      },
    };
  });

  app.get("/api/v1/vision/health", async () => deps.visionHealth());

  app.post("/api/v1/videos", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, "file_required", "Envie o vídeo no campo file.");
    }
    await mkdir(path.join(deps.config.storageRoot, "tmp"), { recursive: true });
    const tempRelative = path.join("tmp", `${randomUUID()}.upload`);
    const tempPath = resolveInside(deps.config.storageRoot, tempRelative);
    await pipeline(file.file, createWriteStream(tempPath));
    if (file.file.truncated) {
      await rm(tempPath, { force: true });
      throw new AppError(413, "file_too_large", `O arquivo excede o limite de ${deps.config.maxUploadBytes} bytes.`);
    }
    try {
      const video = await ingestVideo(
        {
          videos: deps.videos,
          probe: deps.probe,
          decodeCheck: deps.decodeCheck,
          config: deps.config,
        },
        { tempPath, originalName: sanitizeOriginalName(file.filename || "video") },
      );
      return reply.status(201).send({
        videoId: video.id,
        originalName: video.originalName,
        mimeType: video.mimeType,
        sizeBytes: video.sizeBytes,
        durationMs: video.durationMs,
        width: video.width,
        height: video.height,
        nominalFps: video.nominalFps,
        createdAt: video.createdAt.toISOString(),
      });
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  });

  app.post("/api/v1/videos/:videoId/analyses", {
    schema: {
      params: z.object({ videoId: z.string().uuid() }),
      body: analysisConfigSchema,
      response: {
        202: z.object({
          analysisId: z.string().uuid(),
          videoId: z.string().uuid(),
          status: z.literal("queued"),
          configuration: analysisConfigSchema,
        }),
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const video = await deps.videos.findById(request.params.videoId);
    if (!video) {
      throw new AppError(404, "video_not_found", "Vídeo não encontrado.");
    }
    const configuration = analysisConfigSchema.parse(request.body);
    const analysis = await deps.analyses.create({
      id: randomUUID(),
      videoId: video.id,
      configuration,
      now: new Date(),
    });
    request.log.info({ analysisId: analysis.id, videoId: video.id }, "análise enfileirada");
    return reply.status(202).send({
      analysisId: analysis.id,
      videoId: analysis.videoId,
      status: "queued" as const,
      configuration: analysis.configuration,
    });
  });

  app.get("/api/v1/analyses/:analysisId", {
    schema: {
      params: z.object({ analysisId: z.string().uuid() }),
      response: { 200: analysisResponseSchema, 404: errorSchema },
    },
  }, async (request) => {
    const analysis = await requireAnalysis(deps.analyses, request.params.analysisId);
    return serializeAnalysis(analysis);
  });

  app.get("/api/v1/analyses/:analysisId/tracks", {
    schema: {
      params: z.object({ analysisId: z.string().uuid() }),
      querystring: trackQuerySchema,
    },
  }, async (request) => {
    const analysis = await requireAnalysis(deps.analyses, request.params.analysisId);
    requireCompleted(analysis);
    const page = await deps.analyses.listTracks(analysis.id, request.query);
    return {
      disclaimer: analysis.resultSummary?.metricsDisclaimer,
      detectionRatioDenominator: "sampled_frames",
      detectionRatioExplanation: analysis.resultSummary?.detectionRatioExplanation,
      sampledFrameCount: analysis.resultSummary?.sampledFrameCount ?? null,
      gapDefinition: analysis.resultSummary?.gapDefinition,
      ...page,
    };
  });

  app.get("/api/v1/analyses/:analysisId/tracks/:trackId/observations", {
    schema: {
      params: z.object({
        analysisId: z.string().uuid(),
        trackId: z.coerce.number().int().nonnegative(),
      }),
      querystring: pageQuerySchema,
    },
  }, async (request) => {
    const analysis = await requireAnalysis(deps.analyses, request.params.analysisId);
    requireCompleted(analysis);
    const page = await deps.analyses.listObservations(analysis.id, request.params.trackId, request.query);
    if (!page) {
      throw new AppError(404, "track_not_found", "Track não encontrado.");
    }
    return {
      trackerId: request.params.trackId,
      order: "timestampMs,frameNumber",
      ...page,
    };
  });

  app.get("/api/v1/analyses/:analysisId/artifacts", {
    schema: { params: z.object({ analysisId: z.string().uuid() }) },
  }, async (request) => {
    const analysis = await requireAnalysis(deps.analyses, request.params.analysisId);
    requireCompleted(analysis);
    const artifacts = await deps.analyses.listArtifacts(analysis.id);
    return {
      items: artifacts.map((artifact) => ({
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        url: `/api/v1/analyses/${analysis.id}/artifacts/${artifact.kind}`,
      })),
    };
  });

  app.get("/api/v1/analyses/:analysisId/artifacts/:kind", {
    schema: {
      params: z.object({
        analysisId: z.string().uuid(),
        kind: z.enum(["annotated_video", "run_metadata"]),
      }),
    },
  }, async (request, reply) => {
    const analysis = await requireAnalysis(deps.analyses, request.params.analysisId);
    requireCompleted(analysis);
    const artifact = await deps.analyses.findArtifact(analysis.id, request.params.kind);
    if (!artifact) {
      throw new AppError(404, "artifact_not_found", "Artefato não encontrado.");
    }
    const filePath = resolveInside(deps.config.storageRoot, artifact.relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new AppError(404, "artifact_not_found", "Arquivo do artefato não está disponível.");
    }
    const filename = request.params.kind === "annotated_video"
      ? `annotated-${analysis.id}.mp4`
      : `metadata-${analysis.id}.json`;
    return reply
      .header("content-disposition", `inline; filename="${filename}"`)
      .type(artifact.mimeType)
      .send(createReadStream(filePath));
  });

  app.get("/", async (_request, reply) => {
    const page = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/index.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(page);
  });

  return app;
}

function serializeAnalysis(analysis: Awaited<ReturnType<AnalysisRepository["findById"]>> & object) {
  const record = analysis as NonNullable<Awaited<ReturnType<AnalysisRepository["findById"]>>>;
  return {
    analysisId: record.id,
    videoId: record.videoId,
    status: record.status,
    progress: record.progress,
    currentStage: record.currentStage,
    modelName: record.modelName,
    trackerName: record.trackerName,
    configuration: record.configuration,
    resultSummary: record.status === "failed" || record.status === "completed" ? record.resultSummary : record.resultSummary,
    errorCode: record.status === "failed" ? record.errorCode : null,
    errorMessage: record.status === "failed" ? record.errorMessage : null,
    attemptCount: record.attemptCount,
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    links: {
      self: `/api/v1/analyses/${record.id}`,
      tracks: `/api/v1/analyses/${record.id}/tracks`,
      artifacts: `/api/v1/analyses/${record.id}/artifacts`,
    },
  };
}

async function storageReady(root: string): Promise<boolean> {
  try {
    await access(root);
    return true;
  } catch {
    return false;
  }
}

export type { VisionHealth };
