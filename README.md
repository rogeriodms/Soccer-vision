# Football Vision

MVP para detectar e rastrear pessoas em vídeos de futebol gravados por celular, inclusive da lateral ou da arquibancada. A API Node.js recebe o arquivo, enfileira um job no PostgreSQL e um worker chama o serviço Python. O serviço de visão usa YOLO (classe pessoa) e BoT-SORT, grava observações com timestamps do decoder e, se pedido, um vídeo anotado.

O sistema não identifica nomes nem números de camisa. Não calcula passes, posição tática, distância em metros nem velocidade.

## Arquitetura

```
apps/api          Fastify, Zod, Prisma, worker no mesmo processo
apps/vision       FastAPI, Ultralytics YOLO, BoT-SORT, OpenCV, PyAV, FFmpeg
packages/shared   constantes compartilhadas (amostragem, lacunas, avisos)
prisma            schema e migração versionada
storage           uploads, resultados e temporários (não versionados)
models            pesos YOLO (não versionados)
```

O worker faz claim com `SELECT … FOR UPDATE SKIP LOCKED`. Dois workers não pegam o mesmo job. Falhas transitórias (serviço ocupado, timeout, HTTP 5xx) voltam para a fila até `WORKER_MAX_ATTEMPTS`. Pesos ausentes, vídeo ilegível e divergência de timestamps falham na hora. Um retry apaga tracks, observações e artefatos da análise antes de gravar de novo.

Essa fila cabe no MVP. Ela não distribui trabalho entre máquinas, não sobrevive bem a muitos workers concorrentes no mesmo processo e o claim fica preso até `WORKER_STALE_SECONDS` se o processo morrer. Para uma fila dedicada no futuro, mantenha o contrato HTTP `POST /v1/analyze` e troque só o claim: publique o `analysisId` em Redis, SQS ou pg-boss e deixe o worker atual consumir essa mensagem em vez de varrer `status = queued`.

A inferência não roda dentro do `POST` da API. O serviço Python processa um job por vez e responde `503 VISION_BUSY` se outro já estiver em andamento.

## O que os números significam

- A classe detectada é **pessoa** (COCO 0). Árbitro, comissão, gandula e torcida também geram tracks.
- `trackerId` é o identificador do rastreador no vídeo. Não é a identidade de um atleta. Um mesmo jogador pode trocar de ID depois de uma oclusão; dois jogadores podem compartilhar um ID se o tracker errar a associação.
- `observedDurationMs` é o intervalo entre a primeira e a última observação daquele track. Não é tempo de jogo.
- `detectionRatio` = observações / frames amostrados enviados ao detector. O denominador não é o total de frames do arquivo nem o tempo da partida.
- Uma lacuna conta quando o intervalo entre observações consecutivas passa de `2` períodos de amostragem mais `25%` de um período. Com `sampleFps = 3`, o limiar é `750 ms`.
- `sampleFps = 3` é o padrão inicial. Não é suficiente para métricas esportivas precisas.
- Timestamps vêm de `pts * time_base` do decoder (PyAV). Se algum PTS faltar ou a série deixar de ser monotônica, o fallback é `índice do frame / FPS nominal`, com incerteza de um período de frame. O método fica em `resultSummary.timestampMethod`.

## Pré-requisitos

- Node.js 22 ou superior
- Python 3.12 e o módulo `venv`
- FFmpeg e FFprobe no `PATH`
- PostgreSQL 16, ou Docker com Docker Compose
- Espaço para o wheel de CPU do PyTorch e para `models/yolo11n.pt` (cerca de 6 MB)

Verifique a mídia:

```bash
ffmpeg -version
ffprobe -version
```

No Windows, instale o FFmpeg e confira que `ffmpeg` e `ffprobe` respondem no PowerShell.

## Instalação no Linux e no macOS

Na raiz do repositório:

```bash
cp .env.example .env
npm install
python3 -m venv apps/vision/.venv
apps/vision/.venv/bin/pip install --upgrade pip
apps/vision/.venv/bin/pip install torch==2.14.1+cpu torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu
apps/vision/.venv/bin/pip install -r apps/vision/requirements.txt
python3 scripts/download_yolo_weights.py
```

O `torchvision` precisa ser a wheel `+cpu` do índice do PyTorch. A wheel homônima do PyPI quebra com `operator torchvision::nms does not exist`.

O script de pesos baixa `yolo11n.pt` uma vez para `models/`. O serviço recusa a análise se o arquivo não existir e não baixa nada durante o request (`YOLO_OFFLINE=true`, `YOLO_AUTOINSTALL=false`).

### PostgreSQL sem Docker

Crie o usuário e os bancos. A senha abaixo é só para a máquina local:

```bash
sudo -u postgres psql -c "CREATE USER football WITH PASSWORD 'football';"
sudo -u postgres psql -c "CREATE DATABASE football_vision OWNER football;"
sudo -u postgres psql -c "CREATE DATABASE football_vision_test OWNER football;"
```

Confirme autenticação por senha em `127.0.0.1` (em Debian/Ubuntu, `pg_hba.conf` com `scram-sha-256` para `host`).

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

O teste de integração usa `TEST_DATABASE_URL` apontando para `football_vision_test`.

### Subir os três processos

```bash
npm run dev:vision
npm run dev:api
```

A API sobe em `http://127.0.0.1:3000` e já inclui o worker quando `WORKER_ENABLED=true`. A visão sobe em `http://127.0.0.1:8000`. A interface fica em `http://127.0.0.1:3000/`. OpenAPI em `http://127.0.0.1:3000/docs`.

`STORAGE_ROOT` e `MODELS_DIR` relativos são resolvidos a partir da raiz do repositório, mesmo quando o npm executa a API com o diretório de trabalho em `apps/api`. Os dois serviços precisam apontar para a mesma pasta `storage`.

Para um worker separado, deixe `WORKER_ENABLED=false` na API e rode `npm run dev:worker`.

## Instalação no Windows (PowerShell)

```powershell
Copy-Item .env.example .env
npm install
py -3.12 -m venv apps\vision\.venv
apps\vision\.venv\Scripts\python -m pip install --upgrade pip
apps\vision\.venv\Scripts\python -m pip install torch==2.14.1+cpu torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu
apps\vision\.venv\Scripts\python -m pip install -r apps\vision\requirements.txt
py -3.12 scripts\download_yolo_weights.py
npx prisma migrate deploy --schema prisma\schema.prisma
npm run dev:vision
npm run dev:api
```

O PostgreSQL precisa estar escutando em `127.0.0.1:5432` com a URL do `.env`.

## Docker Compose

O arquivo `docker-compose.yml` sobe PostgreSQL 16, a visão e a API, todos publicados só em `127.0.0.1`. Os pesos não entram na imagem: baixe `models/yolo11n.pt` antes e monte a pasta `models/`.

```bash
cp .env.example .env
python3 scripts/download_yolo_weights.py
docker compose up --build
```

A imagem da visão instala PyTorch de CPU. Este Compose não configura GPU. Acesso a GPU no Docker exige o NVIDIA Container Toolkit e um serviço diferente do que está versionado aqui.

## CPU e GPU

O padrão é `VISION_DEVICE=cpu`. Não é necessário GPU para o MVP.

GPU NVIDIA, fora do Compose, só se o PyTorch enxergar CUDA:

1. Instale um driver NVIDIA e um wheel CUDA compatível com a versão do driver, a partir de <https://pytorch.org/get-started/locally/>.
2. Confirme `python -c "import torch; print(torch.cuda.is_available())"`.
3. Defina `VISION_DEVICE=cuda` no `.env` do serviço de visão.

Se `cuda` for pedido e `torch.cuda.is_available()` for falso, a análise falha com `DEVICE_UNAVAILABLE`. O serviço não finge que está usando GPU. `mps` só é aceito se o PyTorch do macOS reportar MPS.

## Testes

```bash
npm test
TEST_DATABASE_URL='postgresql://football:football@127.0.0.1:5432/football_vision_test?schema=public' npm run test:integration
npm run test:vision
```

`npm test` cobre validação de parâmetros, estatísticas, timestamps, transições de job, falha do serviço Python, paginação, duplicidade e path traversal, com repositório em memória.

`test:integration` usa PostgreSQL e FFprobe de verdade. Sem `TEST_DATABASE_URL`, o arquivo é ignorado.

`test:vision` inclui um teste de inferência real. Ele baixa `https://ultralytics.com/images/bus.jpg`, monta um MP4 de 1 segundo e exige pelo menos uma observação de pessoa. Sem `models/yolo11n.pt`, ou sem rede para a imagem, esse teste é pulado. Os demais testes de visão usam um tracker falso e não inventam detecções.

No PowerShell, defina a URL antes do teste de integração:

```powershell
$env:TEST_DATABASE_URL = "postgresql://football:football@127.0.0.1:5432/football_vision_test?schema=public"
npm run test:integration
```

## Analisar o primeiro vídeo

1. Confira `GET http://127.0.0.1:8000/health`. `modelAvailable` precisa ser `true`.
2. Abra `http://127.0.0.1:3000/`.
3. Envie um MP4 ou MOV. A API valida o conteúdo com FFprobe e uma decodificação curta do FFmpeg. Extensão e MIME do cliente não bastam.
4. Inicie a análise. O padrão da interface marca o vídeo anotado. `sampleFps = 3` e confiança `0.25` são os defaults.
5. A página consulta o job a cada 2 segundos, lista os tracks e, ao clicar em um, as observações. O player usa o artefato `annotated_video`.

Equivalente com curl:

```bash
curl -sS http://127.0.0.1:3000/health
curl -sS http://127.0.0.1:3000/api/v1/vision/health

curl -sS -F "file=@/caminho/para/jogo.mp4" http://127.0.0.1:3000/api/v1/videos

curl -sS -X POST http://127.0.0.1:3000/api/v1/videos/VIDEO_ID/analyses \
  -H 'content-type: application/json' \
  -d '{"sampleFps":3,"confidenceThreshold":0.25,"tracker":"botsort","generateAnnotatedVideo":true}'

curl -sS http://127.0.0.1:3000/api/v1/analyses/ANALYSIS_ID
curl -sS "http://127.0.0.1:3000/api/v1/analyses/ANALYSIS_ID/tracks?page=1&pageSize=50&sort=firstSeenMs&order=asc"
curl -sS "http://127.0.0.1:3000/api/v1/analyses/ANALYSIS_ID/tracks/1/observations?page=1&pageSize=50"
curl -sS http://127.0.0.1:3000/api/v1/analyses/ANALYSIS_ID/artifacts
curl -sS -o anotado.mp4 http://127.0.0.1:3000/api/v1/analyses/ANALYSIS_ID/artifacts/annotated_video
```

O `POST` da análise responde `202` com `analysisId` e `status: queued`.

## Endpoints

| Método | Caminho | Função |
| --- | --- | --- |
| GET | `/health` | API, banco, FFmpeg e diretório de storage. Sem segredos. |
| GET | `/api/v1/vision/health` | Visão acessível, pesos e dispositivo. |
| POST | `/api/v1/videos` | Upload `multipart` no campo `file`. |
| POST | `/api/v1/videos/:videoId/analyses` | Enfileira a análise. |
| GET | `/api/v1/analyses/:analysisId` | Status, progresso, etapa, erro sanitizado e resumo. |
| GET | `/api/v1/analyses/:analysisId/tracks` | Tracks paginados. |
| GET | `/api/v1/analyses/:analysisId/tracks/:trackId/observations` | Observações em ordem de tempo. |
| GET | `/api/v1/analyses/:analysisId/artifacts` | Metadados e, se gerado, o vídeo anotado. |
| GET | `/api/v1/analyses/:analysisId/artifacts/:kind` | `annotated_video` ou `run_metadata`. |

Ordenação de tracks: `sort` em `trackerId`, `firstSeenMs`, `lastSeenMs`, `observationCount`, `averageConfidence`, `observedDurationMs`, `detectionRatio`, `gapCount`; `order` em `asc` ou `desc`. `page` começa em 1. `pageSize` vai de 1 a 200.

Defaults da análise: `sampleFps` 3 (0,5–15), `confidenceThreshold` 0,25 (0,01–0,95), `tracker` `botsort`, `generateAnnotatedVideo` `false` na API. A página marca o vídeo anotado por padrão. O outro rastreador aceito é `bytetrack`.

Upload: até `MAX_UPLOAD_BYTES` (500 MiB) e duração até `MAX_VIDEO_DURATION_MS` (3 horas). O nome no disco é um UUID. O nome original só entra no metadado, depois de sanitizado.

## Vídeo anotado

As caixas aparecem nos frames amostrados. O relógio é desenhado em todos os frames. O arquivo original não é sobrescrito. O áudio é remuxado com FFmpeg (`-c:v copy -c:a aac -shortest`) quando a faixa existe e o mux funciona. Se não houver áudio, ou se o mux falhar, `resultSummary.audioPreserved` fica `false` e `audioNote` explica. Em vídeo com FPS variável, o arquivo anotado usa FPS médio constante; a inspeção visual pode desalinhar levemente o relógio desenhado em relação ao PTS original. As observações persistidas continuam com o timestamp do decoder.

## Configuração

Veja `.env.example`. Hosts padrão `127.0.0.1`. Não há autenticação. Não exponha estes serviços na internet.

Limpeza de temporários de upload abandonados:

```bash
npm run cleanup:temp
```

Remove entradas em `storage/tmp` mais velhas que `TEMP_TTL_HOURS` (24). Uploads aceitos e resultados de análise não entram nessa limpeza.

## Rastreador

BoT-SORT vem do Ultralytics 8.4 (`botsort`). O YAML é gerado por job. `track_buffer` é medido em frames processados, então o serviço usa `round(sampleFps * TRACK_BUFFER_SECONDS)` com padrão de 3 segundos. `gmc_method` padrão é `sparseOptFlow`. `with_reid` fica desligado. O estado do tracker persiste entre os frames amostrados da mesma análise e é zerado antes do próximo vídeo. A confiança enviada ao YOLO é o limiar do usuário; caixas abaixo dele não entram na associação.

Ultralytics é AGPL-3.0. Se você distribuir este serviço, cumpra essa licença.

## Limitações conhecidas

- Celular na arquibancada, zoom, oclusão, camisa parecida e câmera tremida aumentam troca de ID e tracks quebrados.
- Pessoas fora de campo entram na mesma classe.
- Sem calibração de campo não há metros, velocidade nem posição tática.
- A amostragem não vê o que acontece entre os frames escolhidos.
- O worker em processo único não é uma fila distribuída.
- Rotação só é aplicada em múltiplos de 90 graus. Outros ângulos ficam sem girar e geram aviso.
- Docker com GPU não faz parte deste Compose.
