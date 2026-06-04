# CLAUDE.md — Project context for Claude Code

This file orients any AI agent working in this repo. Read it before making changes.

## What this is

**Swiss Knife** — a locally-run, private "daily cockpit" web app powered by **local Gemma 4 12B** (via Ollama). It's a personal productivity + AI-tools hub that runs entirely on the user's Mac. No third-party logging; all data stays on-machine.

Target machine: Apple Silicon Mac (M5 / 48GB). Built to be shareable with colleagues.

## Hard rules (do not violate)

1. **Ollama runs NATIVELY on macOS, never in Docker.** Docker Desktop on macOS cannot pass the Apple GPU into a container, so containerized Ollama is CPU-only (~5–6× slower). Containers reach the host Ollama via `host.docker.internal`.
2. **Keep everything local.** No cloud LLM calls from the cockpit. The whole point is privacy + zero API cost for daily tasks.
3. **Respect the tiering.** Local Gemma 12B handles drafting, cleanup, summarizing, organizing, and RAG Q&A. It is NOT for heavy agentic/coding work — that stays with Claude/Cursor. Don't design features that demand more than a 12B can deliver.
4. **Don't commit secrets or local data.** `.env`, `*.db`, and `node_modules/` are gitignored. Keep it that way.

## Engine model

The tag is **`gemma4:12b-mlx`** (MLX build, Apple-Silicon native; dense 12B with image input, function calling, 256K context). Pull with `ollama pull gemma4:12b-mlx`. Embedding model (Phase 4) is `embeddinggemma`. The tag lives in `scripts/pull-models.sh`, `docker-compose.yml`, `.env.example`, and the default in `src/lib/config.ts` / `src/lib/ollama.ts`. To switch tags with no code change, set `OLLAMA_MODEL` (env) or use the in-app **Settings** page.

## Architecture (3 layers)

- **Engine:** Ollama (native) serving `gemma4:12b-mlx` + an embedding model. OpenAI-compatible API at `http://localhost:11434/v1`.
- **Deep-work surface:** Open WebUI (Docker, off-the-shelf) — chat, document RAG, multimodal, prompt library. Configured, not coded.
- **Cockpit (the part we build):** Next.js 15 app (this repo's `cockpit/`). Talks to Ollama directly; owns todo/Kanban/email/prompt tools + a project hub that links into Open WebUI.

## Stack & conventions (cockpit/)

- Next.js 15 (App Router) + TypeScript (strict). Tailwind 3 + **shadcn/ui** (new-york, neutral). Dark mode via **next-themes** (`attribute="class"`); use theme tokens (`bg-background`, `text-muted-foreground`, `border-border`, …), not raw `neutral-*`.
- Prisma + SQLite. DB access through the singleton in `src/lib/db.ts`. Add models to `prisma/schema.prisma`, then `npm run db:push`.
- **Ollama access goes through `src/lib/ollama.ts`** — `chat()` (one-shot) and `streamChat()` (SSE async generator). Don't scatter raw fetches.
- **AI tools use the shared kit** (keeps every tool consistent and quick to add):
  - Page: a `"use client"` component under `src/app/tools/<name>/` that renders `AiToolShell` (`src/components/tools/AiToolShell.tsx`) with `endpoint`, labels, and a `buildBody` fn.
  - API route under `src/app/api/<name>/`: `runtime="nodejs"`, `dynamic="force-dynamic"`, health-gate with `assertOllamaReady()` (`src/lib/health.ts`), then `return streamTextResponse({ messages, temperature, onComplete })` (`src/lib/ai/streamRoute.ts`). Persist in `onComplete` (runs after the full stream is assembled).
  - Client streaming/state is owned by `useAiTool` (`src/hooks/useAiTool.ts`); the in-band error marker is `ERROR_SENTINEL` (`src/lib/ai/sentinel.ts`).
- **Config & health:** effective config (model / baseUrl / temperature) comes from `getEffectiveConfig()` (`src/lib/config.ts`) = Settings row → env → defaults. The `/settings` page edits the single-row `Settings` model. `HealthBanner` + `/api/health` surface "Ollama down" / "model not pulled".
- **Project links:** new content models take an optional `projectId` (relation to `Project`, `onDelete: SetNull`). The full project hub UI comes later.
- Env vars: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `DATABASE_URL`. Local dev reads `cockpit/.env` (gitignored).

## Run / dev

- Full stack (Docker): `./start.sh` → cockpit at :3000, Open WebUI at :3001 (pulls the model first).
- Local cockpit dev: `cd cockpit && npm install && npm run db:push && npm run dev`.
- Quality gates: `npm run lint` (ESLint flat config) and `npm run test:e2e` (Playwright). Tests are model-independent (route-mocked), so they pass without Ollama.
- The app degrades gracefully when Ollama is absent (health banner + 503 with guidance), so most of it can be built and tested without the model running.

## Status & roadmap

- ✅ Phase 0: engine. ✅ Phase 1: cockpit skeleton + Prompt Optimizer.
- ✅ Foundation: model-tag fix, git, shadcn + dark mode, streaming AI-tool kit, settings + health, ESLint + Playwright.
- ✅ Phase 2: shared template engine + seed (`prisma/seed.mjs`, `npm run db:seed`); Prompt Library (CRUD, search, favorite, variable templates, export/import); Email Writer; Brainstorming (technique modes). Open WebUI prompt sync still deferred until OWUI runs.
- ✅ Phase 3: tasks — one `Task` model as a list + dnd-kit Kanban board; AI assists (goal→tasks, daily standup).
- ⬜ Phase 4: knowledge base (Open WebUI RAG, deep-link) · memory facts · PDF (Open WebUI) · image input (Gemma vision)
- ⬜ Phase 5: clipboard quick-capture (macOS Shortcut) · screenshots · project hub

## Working agreements for the agent

- When writing code against a library/framework, **use Context7** ("use context7") to pull current, version-accurate docs rather than relying on training data.
- For end-to-end UI testing, **use the Playwright MCP** explicitly, or run `npm run test:e2e`.
- Keep changes small and committed per feature so they're easy to roll back.
- Update this file and the roadmap when a phase lands.
