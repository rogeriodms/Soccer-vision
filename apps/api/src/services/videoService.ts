import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { ProbeResult } from "../lib/media.js";
import { resolveInside, sanitizeOriginalName } from "../lib/paths.js";
import type { VideoRecord, VideoRepository } from "../repositories/types.js";

export async function ingestVideo(
  deps: {
    videos: VideoRepository;
    probe: (filePath: string) => Promise<ProbeResult>;
    decodeCheck: (filePath: string) => Promise<void>;
    config: AppConfig;
  },
  input: { tempPath: string; originalName: string },
): Promise<VideoRecord> {
  const tempPath = resolveInside(deps.config.storageRoot, input.tempPath);
  const fileStat = await stat(tempPath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new AppError(400, "invalid_video", "O arquivo enviado está vazio.");
  }
  if (fileStat.size > deps.config.maxUploadBytes) {
    throw new AppError(413, "file_too_large", `O arquivo excede o limite de ${deps.config.maxUploadBytes} bytes.`);
  }
  const probed = await deps.probe(tempPath);
  await deps.decodeCheck(tempPath);
  const id = randomUUID();
  const relativePath = path.join("uploads", `${id}${probed.extension}`);
  const finalPath = resolveInside(deps.config.storageRoot, relativePath);
  await mkdir(path.dirname(finalPath), { recursive: true });
  await rename(tempPath, finalPath);
  try {
    return await deps.videos.create({
      id,
      originalName: sanitizeOriginalName(input.originalName),
      storagePath: relativePath.split(path.sep).join("/"),
      mimeType: probed.mimeType,
      sizeBytes: fileStat.size,
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      nominalFps: probed.nominalFps,
      createdAt: new Date(),
    });
  } catch (error) {
    await rm(finalPath, { force: true });
    throw error;
  }
}
