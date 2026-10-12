#!/usr/bin/env python3
"""Baixa os pesos YOLO uma única vez. O serviço de visão não faz este download."""

from __future__ import annotations

import argparse
import hashlib
import os
import urllib.request
from pathlib import Path

RELEASE = "v8.4.0"
DEFAULT_MODEL = "yolo11n.pt"


def main() -> None:
    parser = argparse.ArgumentParser(description="Baixa um peso oficial do Ultralytics para models/.")
    parser.add_argument("--model", default=os.environ.get("YOLO_MODEL", DEFAULT_MODEL))
    parser.add_argument("--output-dir", default=os.environ.get("MODELS_DIR", "models"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    name = Path(args.model).name
    if name != args.model or not name.endswith(".pt"):
        raise SystemExit("Informe apenas o nome do arquivo .pt, sem diretório.")
    destination_dir = Path(args.output_dir)
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / name
    if destination.exists() and not args.force:
        print(f"Já existe: {destination} ({destination.stat().st_size} bytes)")
        return
    url = f"https://github.com/ultralytics/assets/releases/download/{RELEASE}/{name}"
    temporary = destination.with_suffix(".download")
    print(f"Baixando {url}")
    try:
        urllib.request.urlretrieve(url, temporary)
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        raise SystemExit(
            f"Falha no download de {name} ({exc}). "
            f"Confira se o arquivo existe no release {RELEASE} de ultralytics/assets."
        ) from exc
    size = temporary.stat().st_size
    if size < 500_000:
        temporary.unlink(missing_ok=True)
        raise SystemExit("O download ficou pequeno demais e foi descartado.")
    temporary.replace(destination)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    print(f"Salvo em {destination}")
    print(f"sha256 {digest}")


if __name__ == "__main__":
    main()
