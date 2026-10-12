import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import { AppError, sanitizeErrorMessage } from "../lib/errors.js";
import { resolveInside } from "../lib/paths.js";
import type { AnalysisRecord, AnalysisRepository, VideoRepository } from "../repositories/types.js";
import type { VisionSummary } from "../schemas/http.js";
import { importVisionResult } from "../services/importResult.js";
import { VisionRequestError } from "../services/visionClient.js";

export interface WorkerDeps {
  config: AppConfig;
  videos: VideoRepository;
  analyses: AnalysisRepository;
  visionAnalyze: (body: Record<string, unknown>) => Promise<VisionSummary>;
  now: () => Date;
  log: Pick<Logger, "info" | "warn" | "error">;
}

export async function processNextJob(deps: WorkerDeps): Promise<boolean> {
  const token = randomUUID();
  const job = await deps.analyses.claimNext({
    token,
    staleSeconds: deps.config.workerStaleSeconds,
    maxAttempts: deps.config.workerMaxAttempts,
    now: deps.now(),
  });
  if (!job?.claimToken) {
    return false;
  }
  await processClaimedJob(job, deps);
  return true;
}

export async function processClaimedJob(job: AnalysisRecord, deps: WorkerDeps): Promise<void> {
  const log = deps.log;
  const claimToken = job.claimToken;
  if (!claimToken) {
    return;
  }
  const outputRelative = path.posix.join("results", job.id);
  const outputAbsolute = resolveInside(deps.config.storageRoot, outputRelative);
  await mkdir(outputAbsolute, { recursive: true });
  try {
    const video = await deps.videos.findById(job.videoId);
    if (!video) {
      await deps.analyses.markFailed(job.id, claimToken, "VIDEO_NOT_FOUND", "Vídeo não encontrado.", deps.now());
      return;
    }
    log.info({ analysisId: job.id, videoId: job.videoId }, "análise reivindicada");
    const timer = setInterval(() => {
      void syncProgress(deps, job.id, claimToken, outputAbsolute);
    }, 1000);
    let summary: VisionSummary;
    try {
      summary = await deps.visionAnalyze({
        videoPath: video.storagePath,
        outputDir: outputRelative,
        sampleFps: job.configuration.sampleFps,
        confidenceThreshold: job.configuration.confidenceThreshold,
        tracker: job.configuration.tracker,
        generateAnnotatedVideo: job.configuration.generateAnnotatedVideo,
        analysisId: job.id,
        videoId: job.videoId,
      });
    } finally {
      clearInterval(timer);
    }
    const imported = await importVisionResult({
      summary,
      storageRoot: deps.config.storageRoot,
      expected: job.configuration,
      gapFactor: deps.config.significantGapFactor,
      maxObservations: deps.config.maxObservations,
    });
    const outcome = await deps.analyses.saveResults(
      job.id,
      claimToken,
      {
        modelName: summary.modelName,
        trackerName: summary.trackerName,
        resultSummary: imported.summary,
        tracks: imported.tracks,
        artifacts: imported.artifacts,
      },
      deps.now(),
    );
    if (outcome === "lost_claim") {
      log.warn({ analysisId: job.id, videoId: job.videoId }, "claim perdido antes de gravar o resultado");
      return;
    }
    log.info({ analysisId: job.id, videoId: job.videoId, tracks: imported.tracks.length }, "análise concluída");
  } catch (error) {
    const classified = classify(error);
    log.error({ analysisId: job.id, videoId: job.videoId, err: error, code: classified.code }, "falha na análise");
    if (classified.retryable && job.attemptCount < deps.config.workerMaxAttempts) {
      const availableAt = new Date(
        deps.now().getTime() + deps.config.workerRetryBackoffSeconds * 1000 * job.attemptCount,
      );
      await deps.analyses.markRetry(job.id, claimToken, classified.code, classified.message, availableAt);
      return;
    }
    await deps.analyses.markFailed(job.id, claimToken, classified.code, classified.message, deps.now());
    await rm(outputAbsolute, { recursive: true, force: true });
  }
}

export function startWorker(deps: WorkerDeps): { stop: () => void } {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      await processNextJob(deps);
    } catch (error) {
      deps.log.error({ err: error }, "falha no ciclo do worker");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, deps.config.workerPollMs);
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function syncProgress(deps: WorkerDeps, analysisId: string, token: string, outputAbsolute: string): Promise<void> {
  try {
    const raw = await readFile(path.join(outputAbsolute, "progress.json"), "utf8");
    const parsed = JSON.parse(raw) as { progress?: unknown; stage?: unknown };
    if (typeof parsed.progress === "number" && typeof parsed.stage === "string") {
      await deps.analyses.updateProgress(analysisId, token, parsed.progress, parsed.stage);
    }
  } catch {
    // O arquivo de progresso pode ainda não existir.
  }
}

function classify(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof VisionRequestError) {
    return { code: error.code, message: sanitizeErrorMessage(error.code, error.message), retryable: error.retryable };
  }
  if (error instanceof AppError) {
    const retryable = error.code === "VISION_BUSY" || error.code === "VISION_UNAVAILABLE" || error.code === "TIMEOUT";
    return { code: error.code, message: sanitizeErrorMessage(error.code, error.message), retryable };
  }
  return { code: "VISION_FAILED", message: sanitizeErrorMessage("VISION_FAILED"), retryable: false };
}
