import path from "node:path";
import { AppError } from "./errors.js";

export function resolveInside(root: string, candidate: string): string {
  if (candidate.includes("\0")) {
    throw new AppError(400, "invalid_path", "Caminho inválido.");
  }
  const rootResolved = path.resolve(root);
  const candidatePath = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(rootResolved, candidate);
  const relative = path.relative(rootResolved, candidatePath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return candidatePath;
  }
  throw new AppError(400, "invalid_path", "Caminho fora do armazenamento.");
}

export function sanitizeOriginalName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
  return base.length > 0 ? base : "video";
}
