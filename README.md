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
2. **Ollama (native)** — `brew install ollama` or https://ollama.com/download

That's all your colleagues need too.

---

## Run it (one command)

```bash
./start.sh
```

This will:
1. Start the native Ollama server if it isn't already running.
2. Pull `gemma4:12b-mlx` (and the embedding model for the future knowledge base).
3. Build & launch the cockpit + Open WebUI containers.

Then open **http://localhost:3000**.

Stop everything: `docker compose down`

> First run downloads the Gemma model (~10 GB) and builds the cockpit image,
> so it takes a few minutes. Subsequent runs are fast.

> **Model note:** `gemma4:12b-mlx` is the Apple-Silicon (MLX) build — a dense 12B
> with image input, function calling, and a 256K context window. To use a
> different tag, set `OLLAMA_MODEL` or change it on the in-app **Settings** page.

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
- **Phase 4:** Project knowledge base (Open WebUI RAG) · memory facts · PDF ingest · image input (Gemma vision)
- **Phase 5:** Clipboard quick-capture (macOS Shortcut) · screenshots · project hub linking

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
