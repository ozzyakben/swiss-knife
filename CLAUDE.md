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

Two chat tiers, switchable live in **Settings → Model** (a picker that lists installed Ollama models via `/api/models`, plus presets and a custom-tag fallback). Tier metadata + RAM hints live in `src/lib/models.ts`.

- **Light (default) — `gemma4:e4b`** (Gemma "effective-4B"; ~4 GB RAM). The default everywhere (`src/lib/config.ts` / `src/lib/ollama.ts`, `docker-compose.yml`), picked for RAM headroom when Open WebUI runs alongside. Also `gemma4:e2b` (~2 GB) as a preset.
- **Quality — `gemma4:12b-mlx`** (MLX/safetensors, Apple-Silicon native; ~10–14 GB RAM, vision, 256K context). One click away in the picker, or set `OLLAMA_MODEL=gemma4:12b-mlx`.

`scripts/pull-models.sh` pulls **both** tiers plus `embeddinggemma`. The Settings row overrides env at runtime via `getEffectiveConfig()`.

**Vision (important, counter-intuitive):** `gemma4:e4b` is the **vision-capable** model; `gemma4:12b-mlx` has **NO vision** (it silently ignores images and hallucinates). And image input must go through Ollama's **native** `/api/chat` with an `images: [base64]` array — the OpenAI-compatible `/v1` `image_url` path fails for GGUF vision models ("Failed to load image"). So image requests use `chatWithImages` / `streamChatWithImages` (`src/lib/ollama.ts`) + `lib/vision.describeImage`, with model = `getEffectiveConfig().visionModel` (`OLLAMA_VISION_MODEL`, default `gemma4:e4b`). Regular text chat stays on `/v1`. Used by `api/vision` (streamed) and `api/capture` (one-shot).

**Runtime requirement (important):** Ollama must be the official macOS **app** (`brew install --cask ollama-app`), not the Homebrew CLI formula (`brew install ollama`). The formula's bottle ships without the `llama-server` runner, so GGUF models — `gemma4:e4b` and anything you `ollama pull` from the library — fail with "llama-server binary not found". The app bundles all runners (GGUF + MLX). Models live in `~/.ollama` and are shared between them.

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
- ✅ Phase 4: memory facts (injected via `lib/memory.ts`) + image input (Gemma vision, `api/vision`). Knowledge base / RAG + PDF live in Open WebUI, deep-linked per project from the hub (`Project.owuiUrl`).
- ✅ Phase 5: project hub + active-project switcher (cookie via `lib/project.ts`, threaded into create routes); quick-capture (`api/capture` token + macOS Shortcut); Open WebUI integration (RAG deep-link + key-configurable prompt sync `api/prompts/sync`).
- ✅ Audit fixes (2026-06-05): (1) task priority/due/edit UI + `EditTaskDialog`; (2) custom template CRUD (`api/templates`, `api/templates/[id]`) + edit ideas/email (`RecentItems` edit dialog, PATCH on `api/ideas|email/[id]`); (3) image/screenshot capture → Idea w/ vision (`Idea.imagePath`, `lib/vision.ts`, `uploads/`); (4) OWUI sync update-or-create + loud failure. Plus the **light Gemma tier** (`gemma4:e4b`) + Settings model picker (`api/models`, `lib/models.ts`). 21/21 e2e, lint + build green.
- ✅ OWUI prompt sync verified end-to-end (2026-06-05). Gotchas baked into `docker-compose.yml`: OWUI needs `ENABLE_API_KEYS=True` (default False, plural) or the API-key UI/endpoints are off. The current OWUI prompt API uses `name` (not `title`) and updates **by id** (`POST /api/v1/prompts/id/{id}/update`) — the old `/command/{cmd}/update` routes are gone; `api/prompts/sync` matches this. Auto-login with `WEBUI_AUTH=False` only holds for browsers with a saved token; a fresh session hits `/auth`.
- ✅ OWUI RAG verified end-to-end (2026-06-05): OWUI embedding set to `ollama`/`embeddinggemma` (via `POST /api/v1/retrieval/embedding/update`); a doc uploaded to a knowledge base was retrieved and answered (made-up codeword test) by local `gemma4:e4b` — fully local. OWUI chat with the local models also confirmed.
- ✅ LBMH project pack (2026-06-05): generalized seeding into re-runnable, idempotent **project packs**. Added nullable unique `sourceKey` (MemoryFact/Prompt/Task) + `Task.module`; `prisma/seed-lbmh.mjs` (`npm run seed:lbmh`) upserts a local pack into facts/templates/prompts/tasks for one project, and skips cleanly when no pack is present. First pack = "LBMH / Spruce QA": 37 Spruce-glossary + BDD/AI-first-standards memory facts, 4 QA templates (Gherkin authoring, eval rubric, AI verification, stress-test), 3 library prompts, 222 training-tracker tasks (xlsx → `Task` with module + status map), and a local OWUI RAG knowledge base (`Project.owuiUrl`, 9 docs over `embeddinggemma`). New committed tool: **Gherkin lint** (`/tools/gherkin-lint`, `lib/gherkinLint.ts`, `api/gherkin-lint`) — the mechanical QA gate (tags, one event, no leakage, `{Type} [name]`). Pack content lives under gitignored `cockpit/projects/` (ECI IP, local-only); the shareable repo keeps the generic seed. Proof: injecting the real facts takes local `gemma4:e4b` Gherkin from BLOCK to PASS on the gate. lint + build green, 27/27 e2e.
- ⏳ Only remaining: build the macOS capture Shortcut from the documented recipe (Settings → Quick capture). See `HANDOFF-CONTINUE.md`.

## Working agreements for the agent

- When writing code against a library/framework, **use Context7** ("use context7") to pull current, version-accurate docs rather than relying on training data.
- For end-to-end UI testing, **use the Playwright MCP** explicitly, or run `npm run test:e2e`.
- Keep changes small and committed per feature so they're easy to roll back.
- Update this file and the roadmap when a phase lands.
