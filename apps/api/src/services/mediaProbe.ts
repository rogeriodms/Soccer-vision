import type { AppConfig } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { parseProbe, type ProbeResult } from "../lib/media.js";
import { runProcess } from "../lib/process.js";

export function createMediaProbe(config: AppConfig): {
  probe: (filePath: string) => Promise<ProbeResult>;
  decodeCheck: (filePath: string) => Promise<void>;
  ffmpegAvailable: () => Promise<boolean>;
} {
  return {
    async probe(filePath) {
      let result;
      try {
        result = await runProcess(
          config.ffprobePath,
          ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
          config.ffprobeTimeoutMs,
        );
      } catch (error) {
        throw missingTool(error, "ffprobe");
      }
      if (result.code !== 0) {
        throw new AppError(400, "invalid_video", "O arquivo não é um vídeo MP4 ou MOV válido.");
      }
      try {
        return parseProbe(JSON.parse(result.stdout), { maxDurationMs: config.maxVideoDurationMs });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError(400, "invalid_video", "Não foi possível ler os metadados do vídeo.");
      }
    },
    async decodeCheck(filePath) {
      let result;
      try {
        result = await runProcess(
          config.ffmpegPath,
          ["-v", "error", "-i", filePath, "-t", "0.5", "-f", "null", "-"],
          config.ffprobeTimeoutMs,
        );
      } catch (error) {
        throw missingTool(error, "ffmpeg");
      }
      if (result.code !== 0) {
        throw new AppError(400, "invalid_video", "O arquivo não pôde ser decodificado como vídeo.");
      }
    },
    async ffmpegAvailable() {
      try {
        const result = await runProcess(config.ffprobePath, ["-version"], 5000);
        return result.code === 0;
      } catch {
        return false;
      }
    },
  };
}

function missingTool(error: unknown, tool: string): AppError {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return new AppError(500, "tool_missing", `${tool} não está disponível no servidor.`);
  }
  return new AppError(400, "invalid_video", `Não foi possível inspecionar o vídeo com ${tool}.`);
}
