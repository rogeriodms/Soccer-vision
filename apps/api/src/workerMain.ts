import pino from "pino";
import { loadConfig, loadDotEnv } from "./config/env.js";
import { getPrisma } from "./repositories/prismaClient.js";
import { createPrismaAnalysisRepository, createPrismaVideoRepository } from "./repositories/prismaRepos.js";
import { requestVisionAnalysis } from "./services/visionClient.js";
import { startWorker } from "./workers/analysisWorker.js";

loadDotEnv();
const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error("DATABASE_URL é obrigatório para o worker.");
}
const prisma = getPrisma();
const log = pino({ level: config.logLevel });
const worker = startWorker({
  config,
  videos: createPrismaVideoRepository(prisma),
  analyses: createPrismaAnalysisRepository(prisma),
  now: () => new Date(),
  log,
  visionAnalyze: (body) => requestVisionAnalysis({
    baseUrl: config.visionBaseUrl,
    timeoutMs: config.visionTimeoutMs,
    body,
  }),
});
log.info("worker de análise iniciado");

process.on("SIGINT", () => {
  worker.stop();
  void prisma.$disconnect().then(() => process.exit(0));
});
