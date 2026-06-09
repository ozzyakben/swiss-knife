# 🔧 Swiss Knife — Local AI Daily Runner

A locally-run, private "daily cockpit" powered by **local Gemma 4 12B** via Ollama.
Two surfaces, one engine:

- **Cockpit** (`http://localhost:3000`) — your custom Next.js app (Prompt Optimizer today; later: email writer, todo, Kanban, knowledge base).
- **Open WebUI** (`http://localhost:3001`) — off-the-shelf chat + document RAG + prompt library + multimodal.

Everything stays on your machine. No third-party logging.

---

## Why Ollama runs natively (not in Docker)

Docker Desktop on macOS **cannot** pass the Apple GPU into a container — even on M5.
A containerized Ollama falls back to CPU and runs **~5–6× slower**. So Ollama runs
natively (full Metal/GPU acceleration) and the containers reach it via
`host.docker.internal`. This is the recommended setup for any Apple Silicon Mac.

---

## Prerequisites (one-time, per machine)

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
2. **Ollama (native, the official app)** — `brew install --cask ollama-app` or https://ollama.com/download

> ⚠️ **Not** `brew install ollama`. The Homebrew *formula*'s bottle ships without
> the `llama-server` runner, so GGUF models (`gemma4:e4b` and anything you
> `ollama pull` from the library) fail with "llama-server binary not found".
> The official **app** bundles every runner (GGUF + MLX). Already on the
> formula? `brew uninstall ollama && brew install --cask ollama-app`
> (pulled models in `~/.ollama` are kept).

That's all your colleagues need too.

---

## Run it (two commands, total)

```bash
./swiss up      # start everything
./swiss down    # stop the containers when you're done
```

`up` starts the native Ollama app if needed, pulls both model tiers plus the
embedder, then builds & launches the cockpit + Open WebUI containers.
Then open **http://localhost:3000**.

Also there for you:

```bash
./swiss status  # one-line state of engine / cockpit / Open WebUI / Docker
./swiss doctor  # full preflight with fix-it commands (run this first on a new machine)
```

> First run downloads the models (~14 GB for both tiers) and builds the cockpit
> image, so it takes a few minutes. Subsequent runs are fast.

> **Model note:** two chat tiers, switchable live in **Settings → Model**:
> `gemma4:e4b` (light default, vision-capable, ~4 GB RAM) and `gemma4:12b-mlx`
> (quality tier, Apple-Silicon MLX, 256K context, ~10–14 GB RAM, no vision).
> Set `OLLAMA_MODEL` or use the in-app picker to switch.

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
- **Quick capture** — a token-authed endpoint (wire a macOS Shortcut or hotkey) to file text as a
  task, fact, prompt, or idea from any app.
- **Dashboard** — entry point, recent prompts, and a live engine-health banner.
- **Settings** — set the model, base URL, and temperature in-app.
- **Dark mode** — light / dark / system.
- **Graceful offline** — if Ollama isn't running or the model isn't pulled, the app
  tells you exactly what to do instead of failing silently.
- **Open WebUI** — full chat, document upload/RAG, and multimodal, ready immediately.

## Architecture

```
        ┌─────────────────────────── your Mac ───────────────────────────┐
        │                                                                 │
        │   Ollama (NATIVE, GPU/Metal)  ── gemma4:12b-mlx + embeddings    │
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
  run `./start.sh`.

## Local development (without Docker)

```bash
cd cockpit
npm install
npm run db:push        # creates the SQLite schema
npm run dev            # uses cockpit/.env (OLLAMA_*, DATABASE_URL)
```

Quality gates: `npm run lint` and `npm run test:e2e` (Playwright tests are
model-independent, so they pass even without Ollama running).
