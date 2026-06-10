# 🔧 Swiss Knife — Local AI Daily Runner

A locally-run, private "daily cockpit" powered by **local Gemma 4** via Ollama
(light `gemma4:e4b` default + a 12B quality tier). Two surfaces, one engine:

- **Cockpit** (`http://localhost:3000`) — your custom Next.js app (Prompt Optimizer today; later: email writer, todo, Kanban, knowledge base).
- **Open WebUI** (`http://localhost:3001`) — off-the-shelf chat + document RAG + prompt library + multimodal.

Everything stays on your machine. No third-party logging.

---

## Why Ollama runs natively (not in Docker)

Ollama runs **natively on the host** on every platform; the containers reach it
via `host.docker.internal`.

- **macOS:** Docker Desktop cannot pass the Apple GPU into a container — even on
  M5. Containerized Ollama falls back to CPU and runs **~5–6× slower**. Native =
  full Metal acceleration.
- **Windows:** the official Ollama Windows app uses your NVIDIA GPU (CUDA)
  directly when present, falls back to CPU cleanly, and auto-starts with the
  machine. Keeping it out of Docker avoids the WSL2 GPU-passthrough dance for
  zero benefit.

---

## Fastest path (new machine → working cockpit)

```bash
# macOS (needs Homebrew):
git clone <repo-url> && cd swiss-knife && ./swiss setup && ./swiss up
```

```powershell
# Windows 10/11 (PowerShell):
git clone <repo-url>; cd swiss-knife; .\swiss setup; .\swiss up
```

`setup` installs the two prerequisites below (skipping anything already
installed). One honest caveat on a brand-new machine: **Docker Desktop's first
launch is interactive** (license click-through; on Windows it enables WSL2 and
may ask to reboot) — do that once when `setup` tells you to, then `up` is fully
hands-off, forever. `doctor` is always there if anything looks off.

## Prerequisites (one-time, per machine — or just run `setup` above)

**macOS (Apple Silicon)**

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
2. **Ollama (native, the official app)** — `brew install --cask ollama-app` or https://ollama.com/download

> ⚠️ **Not** `brew install ollama`. The Homebrew *formula*'s bottle ships without
> the `llama-server` runner, so GGUF models (`gemma4:e4b` and anything you
> `ollama pull` from the library) fail with "llama-server binary not found".
> The official **app** bundles every runner (GGUF + MLX). Already on the
> formula? `brew uninstall ollama && brew install --cask ollama-app`
> (pulled models in `~/.ollama` are kept).

**Windows 10/11**

1. **Docker Desktop (WSL2 backend)** — https://www.docker.com/products/docker-desktop/
2. **Ollama for Windows** — `winget install Ollama.Ollama` or https://ollama.com/download/windows
3. 16 GB RAM minimum (24 GB+ to run the quality tier next to Docker); an NVIDIA
   GPU helps a lot but isn't required — the light tier runs fine on CPU.

That's all your colleagues need too.

---

## Run it (two commands, total)

macOS:

```bash
./swiss up      # start everything
./swiss down    # stop the containers when you're done
```

Windows (PowerShell or cmd, from the repo folder):

```powershell
.\swiss up      # start everything (swiss.cmd → swiss.ps1, no execution-policy fuss)
.\swiss down    # stop the containers when you're done
```

`up` starts native Ollama if needed, pulls the model tiers plus the embedder,
then builds & launches the cockpit + Open WebUI containers.
Then open **http://localhost:3000**.

Also there for you (same on Windows with `.\swiss`):

```bash
./swiss status  # one-line state of engine / cockpit / Open WebUI / Docker
./swiss doctor  # full preflight with fix-it commands (run this first on a new machine)
```

> First run downloads the models (~9–14 GB depending on platform) and builds the
> cockpit image, so it takes a few minutes. Subsequent runs are fast.

> **Model note:** two chat tiers, switchable live in **Settings → Model**:
> `gemma4:e4b` (light default, vision-capable, ~4 GB RAM) everywhere, plus a
> quality tier that differs by platform — `gemma4:12b-mlx` (Apple-Silicon MLX,
> 256K context, no vision) on macOS, **`gemma4:12b` (GGUF)** on Windows/Linux.
> The MLX tag will not run outside Apple Silicon. Set `OLLAMA_MODEL` or use the
> in-app picker to switch.

---

## What works today

- **Prompt Optimizer** — rewrite a rough prompt into a sharp one using local Gemma,
  streamed token by token, with an option to **save it to your prompt library**
  (SQLite, on-disk).
- **Prompt Library** — manage saved prompts (search, favorite, edit, delete, copy,
  export/import) and run reusable **variable templates** ({{placeholders}} you fill in).
- **Email Writer** — compose or reply with tone and length controls.
- **Brainstorming** — structured thinking techniques (expand, alternatives, premortem,
  pros/cons, SCAMPER, a Socratic sharpen pass); results save as ideas.
- **Tasks** — a todo list and a drag-and-drop Kanban board on one model, with AI
  assists (turn a goal into tasks, generate a daily summary).
- **Memory** — facts about you and your work (manual or AI-suggested), woven into
  the email, brainstorming, and task tools.
- **Image** — ask local Gemma about an uploaded image (vision).
- **Projects** — group prompts/tasks/ideas/drafts/memory by project; the sidebar's active
  project files new work automatically, and each project deep-links to its Open WebUI knowledge base.
- **Quick capture** — a token-authed endpoint to file text as a task, fact, prompt, or idea
  from any app: wire a macOS Shortcut (`scripts/sk-capture.sh`) or a Windows hotkey
  (`scripts\sk-capture.ps1` — recipes in Settings → Quick capture).
- **Dashboard** — entry point, recent prompts, and a live engine-health banner.
- **Settings** — set the model, base URL, and temperature in-app.
- **Dark mode** — light / dark / system.
- **Graceful offline** — if Ollama isn't running or the model isn't pulled, the app
  tells you exactly what to do instead of failing silently.
- **Open WebUI** — full chat, document upload/RAG, and multimodal, ready immediately.

## Architecture

```
        ┌────────────────────────── your machine ─────────────────────────┐
        │                                                                 │
        │   Ollama (NATIVE — Metal on macOS / CUDA-or-CPU on Windows)     │
        │     gemma4:e4b + quality tier (12b-mlx mac · 12b win) + embed    │
        │        ▲                          ▲                             │
        │        │ host.docker.internal     │                             │
        │   ┌────┴───────┐            ┌──────┴──────┐                      │
        │   │  Cockpit   │            │ Open WebUI  │   (Docker Compose)   │
        │   │ Next.js+TS │            │  chat/RAG   │                      │
        │   │ SQLite     │            └─────────────┘                      │
        │   └────────────┘                                                 │
        └─────────────────────────────────────────────────────────────────┘
```

- **Cockpit stack:** Next.js 15 (App Router), TypeScript, Tailwind + shadcn/ui,
  Prisma + SQLite, a thin Ollama client hitting the OpenAI-compatible endpoint.
- **AI-tool kit:** every tool shares a streaming client (`streamChat`), a server
  helper (`streamTextResponse`), a client hook (`useAiTool`), and a UI shell
  (`AiToolShell`). See `CLAUDE.md` for the convention.
- **Data:** cockpit data (prompts, later todos/Kanban/projects) in a SQLite volume;
  Open WebUI keeps its own data volume.

## Roadmap (next phases)

- **Phase 2 (done):** prompt library + variable templates · email writer · brainstorming. (Open WebUI prompt sync still to come.)
- **Phase 3 (done):** tasks — list + dnd-kit Kanban board, AI generate-from-goal + daily summary
- **Phase 4 (in progress):** memory facts (done) · image input via Gemma vision (done) · knowledge base / RAG + PDF via Open WebUI (lands with the Phase 5 hub)
- **Phase 5 (done):** project hub + active-project switcher · quick-capture (macOS Shortcut) · Open WebUI RAG deep-link + prompt sync

## Notes for sharing with colleagues

- `WEBUI_AUTH=False` in `docker-compose.yml` is fine for single-user local use.
  Set it to `True` before exposing Open WebUI beyond localhost.
- The whole thing is reproducible: clone the folder, install the two prerequisites,
  run the doctor (`./swiss doctor` on macOS, `.\swiss doctor` on Windows), then
  `up`.

## Windows specifics & troubleshooting

- **Quality tier:** use `gemma4:12b` (GGUF). `gemma4:12b-mlx` is Apple-Silicon
  MLX and will not run on Windows — the doctor flags it if it sneaks in.
- **Memory consolidation:** set `OLLAMA_QUALITY_MODEL=gemma4:12b` in your `.env`
  so the memory loop's judgment step uses the GGUF build directly.
- **Execution policy:** `.\swiss` runs through `swiss.cmd`, which bypasses the
  policy for this script only. Running `swiss.ps1` directly may need
  `powershell -ExecutionPolicy Bypass -File .\swiss.ps1 doctor`.
- **Line endings (only if you cloned before `.gitattributes` existed):**
  re-normalize once with `git rm -r --cached . ; git checkout .` — otherwise the
  cockpit container can fail with `/bin/sh^M: bad interpreter`.
- **Ports 3000/3001 refuse to bind:** Windows sometimes reserves them
  (`bind: An attempt was made to access a socket...`). Check
  `netsh interface ipv4 show excludedportrange protocol=tcp`; freeing usually
  works with `net stop winnat && net start winnat` (admin).
- **Voice capture** works in the Docker cockpit (the image bundles ffmpeg +
  whisper-cli); it just needs the STT model on the host, mounted automatically
  from `%USERPROFILE%\.cache\whisper` — `.\swiss doctor` prints the one-line
  download if it's missing. (Local `npm run dev` instead uses host ffmpeg +
  whisper-cli: `winget install Gyan.FFmpeg` and a whisper.cpp release binary.)
- **GPU:** nothing to configure — native Ollama accelerates on NVIDIA (CUDA)
  and AMD Radeon (ROCm) automatically; without a supported GPU, stick to
  `gemma4:e4b`.
- **If `.\swiss` doesn't resolve** in your shell, use the explicit form:
  `.\swiss.cmd up`.

## Local development (without Docker)

Needs Node **22+**. First time only, create `cockpit/.env`:

```
DATABASE_URL="file:./dev.db"
OLLAMA_BASE_URL="http://localhost:11434/v1"
```

```bash
cd cockpit
npm install
npx playwright install chromium   # one-time, for the e2e suite
npm run db:push        # creates the SQLite schema
npm run dev            # uses cockpit/.env (OLLAMA_*, DATABASE_URL)
```

Quality gates: `npm run lint`, `npm run test:unit`, and `npm run test:e2e`
(Playwright tests are model-independent, so they pass even without Ollama
running). `npm run clean` removes `.next` cross-platform.
