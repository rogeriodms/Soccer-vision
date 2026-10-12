import { mkdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { buildApp } from "./app.js";
import { loadConfig, loadDotEnv } from "./config/env.js";
import { getPrisma } from "./repositories/prismaClient.js";
import { createPrismaAnalysisRepository, createPrismaVideoRepository } from "./repositories/prismaRepos.js";
import { createMediaProbe } from "./services/mediaProbe.js";
import { requestVisionAnalysis, requestVisionHealth } from "./services/visionClient.js";
import { startWorker } from "./workers/analysisWorker.js";

loadDotEnv();

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error("DATABASE_URL é obrigatório para iniciar a API.");
}

await mkdir(path.join(config.storageRoot, "uploads"), { recursive: true });
await mkdir(path.join(config.storageRoot, "results"), { recursive: true });
await mkdir(path.join(config.storageRoot, "tmp"), { recursive: true });

const prisma = getPrisma();
const media = createMediaProbe(config);
const log = pino({ level: config.logLevel });
const videos = createPrismaVideoRepository(prisma);
const analyses = createPrismaAnalysisRepository(prisma);

const app = await buildApp({
  config,
  videos,
  analyses,
  probe: media.probe,
  decodeCheck: media.decodeCheck,
  ffmpegAvailable: media.ffmpegAvailable,
  databaseCheck: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  },
  visionHealth: async () => {
    const health = await requestVisionHealth(config.visionBaseUrl);
    return {
      status: health.reachable && health.modelAvailable && health.deviceAvailable ? "ok" : "degraded",
      service: "vision",
      ...health,
    };
  },
});

const worker = config.workerEnabled
  ? startWorker({
      config,
      videos,
      analyses,
      now: () => new Date(),
      log,
      visionAnalyze: (body) => requestVisionAnalysis({
        baseUrl: config.visionBaseUrl,
        timeoutMs: config.visionTimeoutMs,
        body,
      }),
    })
  : null;

if (config.apiHost === "0.0.0.0") {
  log.warn("API escutando em todas as interfaces sem autenticação.");
}

await app.listen({ host: config.apiHost, port: config.apiPort });

async function shutdown() {
  worker?.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
