import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const python = process.platform === "win32"
  ? path.join("apps", "vision", ".venv", "Scripts", "python.exe")
  : path.join("apps", "vision", ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error("Ambiente virtual não encontrado. Crie apps/vision/.venv e instale requirements.txt.");
  process.exit(1);
}

const child = spawn(python, [
  "-m",
  "uvicorn",
  "app.main:app",
  "--app-dir",
  "apps/vision",
  "--host",
  process.env.VISION_HOST ?? "127.0.0.1",
  "--port",
  process.env.VISION_PORT ?? "8000",
], { stdio: "inherit" });

child.on("exit", (code) => process.exit(code ?? 1));
