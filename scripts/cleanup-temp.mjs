import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.STORAGE_ROOT ?? "storage");
const hours = Number(process.env.TEMP_TTL_HOURS ?? 24);
const directory = path.join(root, "tmp");
const cutoff = Date.now() - hours * 60 * 60 * 1000;
let removed = 0;

try {
  const entries = await readdir(directory);
  for (const entry of entries) {
    const candidate = path.resolve(directory, entry);
    if (!candidate.startsWith(`${directory}${path.sep}`)) {
      continue;
    }
    const info = await stat(candidate);
    if (info.mtimeMs < cutoff) {
      await rm(candidate, { recursive: true, force: true });
      removed += 1;
    }
  }
} catch (error) {
  if (error && error.code !== "ENOENT") {
    throw error;
  }
}

console.log(`Arquivos temporários removidos: ${removed}`);
