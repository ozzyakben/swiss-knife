# Production readiness audit — findings appendix (2026-06-10)

Audit of the uncommitted working tree vs HEAD c78fc12 (production-ready round + Windows support).
61-agent adversarial review (8 dimensions, find → refute-verify → completeness critic): 42 confirmed, 0 refuted, 6 critic additions.
Items marked FIXED were corrected in the working tree during this audit; the rest are open, prioritized.

## Confirmed findings (panel)

### [HIGH] swiss.ps1 crashes under Windows PowerShell 5.1 when Docker Desktop is not running (the exact state it diagnoses) — **FIXED in this audit**
`swiss.ps1:93` · dimension: cross-platform-ops

Test-DockerUp runs `docker info 2>$null | Out-Null` with script-scope `$ErrorActionPreference = "Stop"` (line 28) and no try/catch. In Windows PowerShell 5.1 — and pwsh 7.0/7.1; only PowerShell 7.2+ exempted native stderr from $ErrorActionPreference — redirecting a native command's stderr (including 2>$null) wraps each stderr line in an ErrorRecord routed through the error stream, and with EAP=Stop the first line throws a terminating NativeCommandError. When Docker Desktop is installed but not running, `docker info` writes 'error during connect: ...' to stderr, so the uncaught throw kills the script. swiss.cmd explicitly launches `powershell` (= WinPS 5.1), making this the DEFAULT path: `.\swiss status`, `.\swiss doctor`, `.\swiss up`, and `.\swiss down` all call Test-DockerUp, so instead of the designed friendly 'Docker daemon isn't running - start Docker Desktop' guidance, a colleague gets a raw red NativeCommandError mid-output. This hits the documented first-run flow too: after `.\swiss setup` installs Docker Desktop but before its interactive first launch, `.\swiss up` reaches step 3 and crashes. Note the sibling call `docker compose ps --status running --services 2>$null` (line 186) IS wrapped in try/catch — the same guard is needed here (or temporarily set EAP to Continue around the probe). The header's claim 'PowerShell 5.1+ (works in Windows PowerShell and pwsh 7)' is not currently true for this code path; Ozzy's all-green hardware verification would not have caught it because Docker was running.

### [MEDIUM] Wrap-up routine stamps a project on globally-scoped content (only standup is actually scoped) — **FIXED in this audit**
`cockpit/src/lib/routines.ts:111` · dimension: api-routes

This diff threads the active-project cookie into runRoutine (routines/[slug]/route.ts:37-40, comment: "Browser-initiated runs (the palette) carry the active-project cookie and scope the routine"). But only the standup branch scopes its queries via buildStandupBoard(projectId); the wrapup branch's queries (tasks completed today, QA sessions touched, activity captures) have no projectId filter — they aggregate ALL projects plus global. The resulting Idea and activity row are nonetheless stamped with the active projectId (`prisma.idea.create({ data: { ..., projectId } })`). So a colleague running wrap-up with project A active files a summary containing project B's completions under project A. Previously the wrapup idea was always global (projectId omitted), so this misattribution is newly introduced.

### [MEDIUM] Eval case verdict overrides survive regeneration and silently relabel new cases saved to the bench
`cockpit/src/app/../src/components/eval/EvalCaseGenerator.tsx:60` · dimension: client-ui

generate() resets result and accepted but NOT verdictOverrides, which is keyed by case INDEX. After the user flips a verdict on case N in batch 1 and then regenerates, the override sticks to whatever case lands at index N in batch 2 — both in the displayed PASS/BLOCK toggle and, critically, in accept(), which persists `verdictOverrides[idx] ?? c.expectedVerdict` as the golden's expectedVerdict. A normal flow (generate → correct a label → tweak spec → regenerate → accept) silently writes a wrong human label into the eval bench, corrupting the very drift signal the bench exists to measure. Fix: setVerdictOverrides({}) alongside setAccepted({}) in generate().

### [MEDIUM] ⌘K ?q= deep links do nothing when already on the target page (useState-seeded search boxes)
`cockpit/src/components/tasks/TasksView.tsx:91` · dimension: client-ui

The new search-result deep links (/tools/tasks?q=…, /tools/memory?q=…, /tools/prompt-library?q=… from api/search) are consumed by seeding useState with the prop: TasksView.tsx:91 `useState(initialQuery)`, MemoryManager.tsx:153 `useState(initialSearch)`, PromptLibrary.tsx:75 `useState(initialQuery)`. In the App Router, navigating to the same route with only searchParams changed re-renders the server page and passes the new prop, but the mounted client component keeps its state — useState ignores the new initial value. So selecting a palette result while ALREADY on Tasks/Memory/Prompt Library updates the URL but the search box and list don't change; the user lands on an unfiltered page and has to hunt for the item again — exactly the failure mode the search-route comment says this round fixed. (QaPipeline does it right with an effect keyed on initialSessionId, and RecentItems' highlightId is prop-driven; only these three useState seeds break.) Fix: sync on prop change (effect keyed on the prop) or key the component by the query.

### [MEDIUM] Smart Inbox shows stale lint verdict and line numbers after the text is edited
`cockpit/src/components/tools/InboxTool.tsx:118` · dimension: client-ui

lint state is cleared only in onDrop (`setLint(null)` at line 41). Typing or pasting into the textarea goes through `onValueChange={setText}` (line 118) without clearing it, so after a lint the user can edit the feature text (e.g. fix the reported errors) while the old PASS/BLOCK badge, error/warning counts, and now-wrong line numbers stay on screen claiming to describe the current text. A user can read a stale BLOCK as 'my fix didn't work' or a stale PASS as 'this edited text is clean'. Fix: clear lint in the onValueChange handler (or recompute).

### [MEDIUM] Server-side "local day" reintroduces the calendar-day off-by-one under Docker (no TZ in the container) — **FIXED in this audit**
`cockpit/src/lib/dates.ts:28` · dimension: libs

localDayString() and utcNoonOfLocalDay() are documented as the user's LOCAL calendar day, but every consumer runs them server-side, and in the primary documented run mode (./swiss up, cockpit in Docker) the container has no TZ configured (grep TZ over docker-compose.yml and cockpit/Dockerfile returns nothing), so Node defaults to UTC. Consequences for a US-timezone user any evening (after 5–8pm local = past UTC midnight): (1) DailyBrief (server component, DailyBrief.tsx:31 `const todayStr = localDayString()`) shifts a day forward — tasks due today render as overdue and tomorrow's as due-today; (2) quick-add's deterministic date parse (api/quick-add/route.ts:99 `extractDueDate(text)` with default `now = new Date()`) makes "tomorrow" land the day AFTER tomorrow, and `now.getDay()` weekday math in quickDates.ts:39 computes from the UTC weekday; (3) lib/routines.ts wrapup's "today" window (`startOfDay(new Date())`, line 76) starts at UTC midnight = 5pm PDT, so an evening wrap-up misses everything completed earlier in the user's day, and `ymd()` (line 23-25, toISOString on a local-midnight date) stamps Standup/End-of-day titles with the wrong date east of UTC. This is exactly the off-by-one class the round's UTC-noon storage convention set out to kill — storage/display (dueDayString/formatDueDay) are now immune, but the "what day is it / which day did you mean" computations still assume server TZ == user TZ. Fix options: set TZ in docker-compose (pass the host TZ through), or compute the day client-side and send it with the request.

### [MEDIUM] Growth WARNs in diff mode fire on unchanged context lines, not just added code
`cockpit/src/lib/complexity.ts:167` · dimension: libs

withGrowthWarnings scans the whole reconstructed hunk fragment (context + added lines) and only skips hunks with zero added lines. The smell scanner it rides on deliberately drops issues on non-added lines (codeSmells.ts:533-535 `if (!hunk.added.has(l)) return null; // only review the change itself`), but collectGrowthWarnings has no such filter. Concrete case: a one-line edit inside an existing triple-nested loop — the three `for (` lines and the function header arrive as space-prefixed context, scanComplexity finds loopDepth 3, and the diff review reports "`hot` nests iteration 3 deep — likely O(n^3) growth" for code the diff did not introduce (pinned to a context line, or to mapLine(1) when the header is outside the hunk). The guard comment ("pure deletions can't add growth") and the test name ("flags 3-deep iteration introduced by a diff") both show the intent is introduced-by-the-diff; the test only covers an all-added hunk so this slips through. Fix: require at least one of the flagged function's loop-start lines (or the fn header) to be in hunk.added, mirroring the codeSmells lineMap contract.

### [MEDIUM] Big-O estimate runs the raw unified diff through scanComplexity — deleted lines count as live growth mechanisms
`cockpit/src/app/api/complexity/route.ts:51` · dimension: libs

Code Review explicitly accepts unified diffs ("Paste TS/JS code or a unified diff…", and the withGrowthWarnings docstring calls diffs "this tool's primary daily input"), and BigOSection is always rendered with the raw editor content (CodeReviewer.tsx:149 `<BigOSection code={code} ... />`). But /api/complexity has no diff handling: `scanComplexity(code)` lexes the diff text as code, so removed `-` lines still match LOOP_KEYWORD/SORT_CALL (the `-` prefix doesn't break the \b match on `for (`). A diff that REMOVES an inner loop (an optimization) still scans as having nested loops, so auditClaim can stamp an O(n²) claim "scan-consistent" against code that no longer exists; the model is also asked to analyze diff syntax as a snippet, and hotspot line numbers refer to diff-buffer lines. The sibling growth-warning path got per-hunk new-file-side handling in this round; the Big-O path got none. Fix: when looksLikeDiff(code), reconstruct the new-file side (parseDiffHunks fragments) before scanning/prompting, or disable the Estimate button for diff input.

### [MEDIUM] Foreign-language 'end' tell false-positives on plain TS object/type literals
`cockpit/src/lib/codeSmells.ts:44` · dimension: libs

The Python/Ruby tell `/^\s*(elif|end)\b/m` matches any line beginning with the identifier `end` — which is everyday TypeScript: an `end: number;` property in a type/interface or multi-line object literal, or an `end = …` assignment at statement start. codeSmells.ts itself contains `end: number; // index of matching closing brace` (line 198) — pasting this very file into Code Review emits "This looks like Python/Ruby — the scanner only understands TS/JS, so findings below may be wrong", discrediting an otherwise correct scan. It also fires on diff CONTEXT lines (the leading space satisfies ^\s*), so TS diffs touching such code get mislabeled, while genuinely foreign diffs largely escape detection because added lines' `+` prefix defeats the ^\s*-anchored Python/Go/Rust tells. The detector also runs on raw text before stripCode, so comments/strings can trigger any tell. Fix: require stronger evidence for the Ruby/Python tell (e.g. `\bend\s*$` with no `:`/`=`/`(` after, or pair it with a second tell), run detection on stripped code, and strip diff prefixes first.

### [MEDIUM] Wrap-up routine content is global but its Idea/activity row is stamped with the active project — **FIXED in this audit**
`cockpit/src/lib/routines.ts:91` · dimension: libs

runRoutine now takes projectId and the routine route passes the active-project cookie ("Browser-initiated runs (the palette) … scope the routine"). The standup branch is genuinely scoped via buildStandupBoard, but the wrapup branch's three queries (tasks completed today, QA sessions touched, activity captures) have no project filter at all — yet the resulting Idea is created with `projectId` and the activity log row carries it too (lines 111-112). Running wrap-up from the palette with project A active produces a summary containing project B's completions and QA work, filed and labeled as project A. Either scope the wrapup queries like buildStandupBoard does, or store the wrapup Idea unscoped (projectId: null).

### [MEDIUM] Referenced .gitattributes file does not exist — CRLF protection and README fix are phantom — **FIXED in this audit**
`README.md:186` · dimension: cross-platform-ops

The Windows-support round's claimed CRLF cornerstone is missing: `.gitattributes` exists nowhere in the working tree and was never committed (`find . -name .gitattributes` empty, `git log -- .gitattributes` empty), yet three places depend on it. README.md:186 tells Windows users 'Line endings (only if you cloned before .gitattributes existed): re-normalize once with git rm -r --cached . ; git checkout .' — without the file, every clone 'predates' it and the renormalize is a no-op: with Git-for-Windows' default core.autocrlf=true the re-checkout reproduces CRLF, so a user following the documented troubleshooting step sees nothing change. cockpit/Dockerfile:25-26 calls its sed 'belt-and-suspenders for Windows checkouts that predate .gitattributes' when it is in fact the only protection, and it only covers docker-entrypoint.sh — nothing pins `swiss`/`scripts/*.sh` to LF or `swiss.cmd` to CRLF for future commits made from Windows machines. CLAUDE.md's Windows-support entry lists '.gitattributes' as a shipped blocker fix. Either the file was never created or it was lost; it must be added (e.g. `* text=auto`, `*.sh text eol=lf`, `swiss text eol=lf`, `docker-entrypoint.sh text eol=lf`, `*.cmd text eol=crlf`) before this round ships.

### [MEDIUM] .dockerignore *.db patterns are root-only — the live dev database (capture token + ECI IP facts) is baked into the cockpit image — **FIXED in this audit**
`cockpit/.dockerignore:4` · dimension: cross-platform-ops

Unlike .gitignore, .dockerignore patterns without `**/` match only at the build-context root, so `*.db` / `*.db-journal` / `*.db-wal` / `*.db-shm` (lines 4-7) do NOT exclude cockpit/prisma/dev.db. That is exactly where the README-documented local-dev setup puts the database: README.md tells users to set `DATABASE_URL="file:./dev.db"` in cockpit/.env (lines ~199-203), and Prisma resolves SQLite paths relative to schema.prisma, i.e. cockpit/prisma/dev.db — which exists right now on this machine (233 KB, cockpit/prisma/dev.db, the LBMH dev DB). The Dockerfile's build stage `COPY . .` (line 13) pulls it into the context/layer and the runner stage `COPY --from=build /app/prisma ./prisma` (line 21) ships it in the FINAL image at /app/prisma/dev.db: every memory fact (including the LBMH/Spruce ECI-IP glossary), tasks/ideas/email drafts, and the Settings row containing the capture token (a live credential). This is precisely the leak class this round's .dockerignore extension was meant to close ('.env was baked into image layers'). Fix: change lines 4-8 to `**/*.db`, `**/*.db-journal`, `**/*.db-wal`, `**/*.db-shm`, `**/data` (the `data` pattern on line 8 has the same root-only limitation).

### [MEDIUM] ⌘K task deep link can land on a view where the target task is invisible (persisted project scope)
`cockpit/src/components/tasks/TasksView.tsx:130` · dimension: ux-consistency

/api/search queries tasks with NO project scoping, but the tasks page defaults to a persisted project scope ('sk:tasks:scope' = 'project'). A ⌘K result for a task that belongs to a different project deep-links to /tools/tasks?q=<title>, which seeds the search box — and the scope filter then hides the task. The user sees '0 of N' with a Clear button, but clearFilters() only resets query/priority/module, not scope, so even Clear doesn't reveal the task. Brainstorm and Email solved the analogous problem by explicitly fetching the deep-linked item (brainstorm/page.tsx:36, email-writer/page.tsx:24); tasks has no equivalent escape hatch.

### [MEDIUM] ⌘K fact deep link can be masked by persisted Memory project/category filters
`cockpit/src/components/memory/MemoryManager.tsx:206` · dimension: ux-consistency

/api/search queries memory facts globally (only status:'active', deletedAt:null), but the Memory page deep link (/tools/memory?q=<key>) only seeds the search box. Visibility is the AND of inFilter (persisted 'sk:memory:project'), inCategory (persisted 'sk:memory:category'), and the seeded search — so a user who previously filtered Memory to one project or one category lands on a page where the fact they selected in the palette is filtered out, with no indication it exists. The persisted-value validation (lines 146-152) only guards against stale/garbage values, not against a valid filter hiding the deep-link target.

### [MEDIUM] completedAt transition-only fix has zero regression coverage
`cockpit/src/app/api/tasks/reorder/route.ts:40` · dimension: test-drift

The diff fixes one of the round's top-ranked bugs in two places: board reorder no longer re-stamps completedAt on every done-column task (reorder/route.ts:36-43), and PATCH /api/tasks/[id] only changes completedAt on a real status transition ([id]/route.ts:29-44, which also adds a new findUnique + 404 path and activity logging). Nothing tests either path: tasks.spec.ts never drags a card or completes a task, there is no unit test for the route logic, and the wrapup routine that the old bug broke (completedAt >= today) has no test either. A regression here silently rewrites completion history again and only shows up days later in wrapup output. This is the single riskiest untested change in the diff.

### [MEDIUM] Save-after-run persist branches tested only for the prompt optimizer; email, template runner, and bug report persist paths uncovered
`cockpit/src/app/api/email/route.ts:46` · dimension: test-drift

The trust-pattern kill ("X & save" must save the reviewed result verbatim, never re-run the model) is the round's headline change across four tools, but only one got a test: prompt-optimizer.spec.ts gained "saves the visible result AFTER the run" (asserts the POST /api/prompts body equals the on-screen text). The three sibling persist branches have no e2e or unit coverage: /api/email persist (email/route.ts:46-59, including the new deterministic deriveDraftTitle Subject:-line extraction at lines 18-21), /api/templates/run persist with its idea-vs-prompt branch (templates/run/route.ts:43+), and /api/bug-report report-save which re-runs the checkReport gate and must 400 on missing fields (bug-report/route.ts:43-60). The component side (EmailWriter saveDraft snapshotting lastRun.current, TemplateRunner lastRunValues, BugReportTool lastRunNote) — the exact "inputs that produced the output" pairing the final Codex review demanded — is equally untested. A regression in any of these re-introduces saving an unseen variant, and nothing trips.

### [MEDIUM] ⌘K deep-link chain (search hrefs + 6 page consumers + Inbox→Gherkin prefill) shipped with no test, including in the spec this diff touched
`cockpit/src/components/qa/QaPipeline.tsx:133` · dimension: test-drift

/api/search now emits item-targeted hrefs (?session=, ?q=, ?ideaId=, ?draftId= — search/route.ts:72-110) and six surfaces grew consumption logic: QaPipeline fetches the deep-linked session on mount (QaPipeline.tsx:133-134, via the new async searchParams page wrapper), brainstorm and email-writer pages do an explicit fetch-if-outside-recent-slice, memory/tasks/prompt-library seed their search boxes. None of this is exercised: qa-pipeline.spec.ts was modified in this diff yet never navigates to /tools/qa-pipeline?session=…, and no spec uses any of the params. The same gap covers the Smart Inbox → Gherkin Lint sessionStorage handoff (GHERKIN_PREFILL_KEY written in InboxTool.openInLint, consumed one-time in GherkinLinter.tsx:35-43) — built specifically because the previous clipboard handoff "landed on an empty page in practice", i.e. this exact flow already broke silently once, and it still has no test (gherkin-lint.spec.ts only tests direct paste; there is no inbox spec).

### [MEDIUM] New goldens manager, per-case bench results, human verdict picker, and the new golden/[id] route have zero coverage
`cockpit/src/app/api/qa-pipeline/golden/[id]/route.ts:10` · dimension: test-drift

The human-labeled golden workflow is new in this diff and entirely untested: (a) the untracked /api/qa-pipeline/golden/[id] PATCH (relabel, validates PASS|BLOCK) and DELETE (P2025-idempotent) route; (b) the Manage goldens list/relabel/remove UI (QaPipeline.tsx:80-113, 417-418); (c) the per-case bench results table that must render an engine ERROR distinctly from drift (QaPipeline.tsx, BenchResult rows with `ERROR (engine)` badge, fed by bench/route.ts:29-43); (d) the QaSessionView verdict picker that lets the human save a disagreement golden and attributes it to the SESSION's project via sessionId (QaSessionView.tsx saveGolden + golden/route.ts:22-30 — itself a fix from the final adversarial review). The qa-pipeline.spec.ts was updated for the delete ConfirmDialog but none of these. A mislabeled or mis-filed golden permanently skews the bench agreement % — the route's own comment says so — and the bench is the project's drift detector, so the detector itself is unguarded.

### [MEDIUM] DailyBrief rewrite untested; take:50 ascending window can hide due-today tasks behind 50+ overdue ones
`cockpit/src/components/DailyBrief.tsx:46` · dimension: test-drift

DailyBrief was rewritten in this diff: calendar-day overdue/due-today split via dueDayString (lines 79-80), a settle() wrapper so a DB failure renders a degraded warning instead of a green all-clear (line 90), and one combined query for all not-done tasks with a due date — `take: 50` ordered dueDate asc (line 46), filtered in JS afterwards. No test covers any of it (it's a server component; no e2e asserts the Today panel's contents or the failure state). The window itself is a real edge case: with 50 or more overdue not-done tasks, the ascending slice fills entirely with overdue rows and `dueToday` at line 80 is computed from a window that never reaches today — due-today silently shows empty. The LBMH pack seeds 222 tasks, so an aging tracker plausibly crosses 50 overdue. The lib functions (dueDayString etc.) are unit-tested in dates.test.ts, but the windowing and the failed-vs-clear branch are not.

### [LOW] Headless/palette routine runner returns 500 for the empty-board user state — **FIXED in this audit**
`cockpit/src/app/api/routines/[slug]/route.ts:43` · dimension: api-routes

New behavior in this diff: buildStandupBoard() returns null on an empty/scoped-empty board and runRoutine() now throws Error("No tasks to summarize yet.") (lib/routines.ts:84). The route's catch maps every throw to a 500, so a fresh project (or new user) firing the palette's Standup action or a scheduled Shortcut gets a 500 for a normal user state. The sibling streamed route /api/tasks/standup maps the identical condition to a 400 (tasks/standup/route.ts:17). Before this change, an empty board still produced a (degenerate) summary, so this is a newly introduced 5xx-on-user-state path. The error message does survive to the client toast, so impact is a wrong status class plus log noise, not data loss.

### [LOW] Memory PATCH logs an "accepted" activity for archive restores, not just pending→active accepts
`cockpit/src/app/api/memory/[id]/route.ts:101` · dimension: api-routes

The new activity hook fires on `data.status === "active"` without checking the fact's PREVIOUS status, while the comment claims "A pending → active flip is the human accept". MemoryManager's Archived-section restore button sends exactly `{status: "active"}` (MemoryManager.tsx:831-833 `onClick={() => patch(f.id, { status: "active" })}`), so every unarchive — and any redundant active→active patch that happens to include status — is recorded as a fact "accepted" in the activity timeline (which the wrapup routine also reads as a capture source). Mislabels the loop's key human-gate event; no data integrity impact.

### [LOW] Golden-case relabel (PATCH) masks real DB errors as 404, unlike its own DELETE
`cockpit/src/app/api/qa-pipeline/golden/[id]/route.ts:23` · dimension: api-routes

New route. The DELETE handler in the same file correctly distinguishes P2025 (idempotent ok) from genuine DB errors (500), per the prior hardening pass ("only treat P2025 as idempotent-ok"). The PATCH handler's catch-all maps every failure — including a real DB error mid-relabel — to 404 "Golden case not found.", so a relabel that failed for an unrelated reason reads as the case not existing, and the manager UI will show a misleading message. A relabel that silently fails skews the bench's agreement % (the stated reason this route exists).

### [LOW] POST /api/ideas silently drops an unparseable image data URL (capture returns 400 for the same input)
`cockpit/src/app/api/ideas/route.ts:30` · dimension: api-routes

New route backing the Image tool's "Save as idea". If `image` starts with "data:image" but doesn't match saveDataUrlImage's `data:image/<type>;base64,<data>` regex (e.g. a non-base64 data URL), saveDataUrlImage returns null and the idea is created with imagePath:null and a plain 200 — the image is lost with no indication. The sibling capture route treats the identical condition as a 400 "Unsupported image format." (capture/route.ts:68-70). Practically hard to hit from the current Image page (it sends the base64 URL it rendered), but the response shape hides a partial failure.

### [LOW] DailyBrief's calendar-day split uses the server's timezone — UTC in the Docker stack, shifting overdue/due-today by the user's UTC offset — **FIXED in this audit**
`cockpit/src/components/DailyBrief.tsx:31` · dimension: client-ui

DailyBrief is a server component; `localDayString()` returns the SERVER's local calendar day. In the primary `./swiss up` deployment the cockpit container sets no TZ (docker-compose.yml has no TZ env), so Node runs UTC. For a user west of UTC (e.g. US), from ~5-8 PM local onward the server's 'today' is tomorrow: tasks genuinely due today are listed as Overdue and tomorrow's tasks as Due today; east of UTC the panel lags after local midnight. This is the same off-by-one class the round's dates.ts work targeted — storage (UTC noon) and display (dueDayString ISO part) are fixed, but the 'what day is it' anchor regressed to container TZ. quickDates' utcNoonOfLocalDay ("tomorrow", "on friday" in quick-add) anchors on the same server clock. Local `npm run dev` is unaffected (host TZ). Fix: pass TZ into the container (compose env) or derive 'today' from a client-supplied offset.

### [LOW] DailyBrief's single take:50 due-date query can starve the Due today bucket and drops priority ordering
`cockpit/src/components/DailyBrief.tsx:46` · dimension: client-ui

The old code ran separate overdue and due-today queries (due-today ordered by priority desc). The new single query takes the 50 earliest-due non-done tasks and splits them client-side. With more than 50 overdue tasks (plausible with the 222-task LBMH training pack if dated), every slot is consumed by overdue rows and tasks actually due today silently vanish from the panel; the due-today list is also now ordered by dueDate instead of priority. Edge case for a healthy backlog, real for a stale one.

### [LOW] BigOSection and BugReportTool elapsed-time intervals and fetches have no unmount cleanup
`cockpit/src/components/code/BigOSection.tsx:51` · dimension: client-ui

useAiTool gained an unmount abort this round, but the hand-rolled one-shot tools didn't get the equivalent: BigOSection.analyze() and BugReportTool.run() (and EvalCaseGenerator.generate(), same pattern) start a 500ms setInterval cleared only in the fetch's finally block, and the fetch itself is not aborted on unmount. Navigating away mid-analysis leaves the interval firing setState on an unmounted component until the request settles — up to the 300s server generation timeout if the engine is cold/hung. Harmless functionally (React 18 ignores the setState) but a real timer/request leak; an unmount effect that clears the ref'd interval (and optionally aborts) matches the useAiTool fix.

### [LOW] Memory PATCH accepts an empty value and skips the re-embed, leaving the stale vector on an emptied fact
`cockpit/src/app/api/memory/[id]/route.ts:82` · dimension: libs

The new re-embed-on-edit block guards with `typeof data.value === "string" && data.value`, so a PATCH whose value trims to "" (a) is not rejected — the fact's value is blanked (line 60 sets `data.value = body.value.trim()` with no emptiness check, unlike POST /api/memory which 400s on empty) and (b) keeps the OLD embedding, contradicting the block's own comment "never leave the stale vector in place": the empty fact keeps ranking by its former meaning and reindexFacts won't touch it (embedding is non-null). Edge case (the MemoryManager UI likely prevents empty saves), but the API contract should reject empty values outright, which fixes both halves.

### [LOW] Documented .gitattributes does not exist anywhere in the repo — **FIXED in this audit**
`README.md:186` · dimension: security

The Windows-support work documents a .gitattributes file as shipped, but the file is absent from the working tree and from all of git history (find across the repo and `git log --oneline --all -- .gitattributes` both return nothing). README.md line 186 says line-ending trouble applies 'only if you cloned before .gitattributes existed' and prescribes `git rm -r --cached . ; git checkout .` — which re-applies the same core.autocrlf rules and fixes nothing when no .gitattributes exists. The modified CLAUDE.md likewise claims '**New:** .gitattributes (CRLF checkouts broke docker-entrypoint.sh…)'. A Windows colleague cloning with autocrlf=true (the Windows default) still gets CRLF in docker-entrypoint.sh, swiss, and scripts/pull-models.sh; only the container entrypoint is mitigated (the Dockerfile sed). The documented control was never created — add the .gitattributes or correct both docs.

### [LOW] saveDataUrlImage accepts an unbounded MIME-subtype as file extension — crafted data URL 500s capture and ideas routes
`cockpit/src/lib/uploads.ts:8` · dimension: security

The extension is taken verbatim from the data-URL MIME subtype with no length or allowlist check: `data:image/<1MB of 'a'>;base64,xxxx` passes the regex (the char class allows arbitrarily many [a-zA-Z0-9.+-]), so writeFile is called with a multi-kilobyte filename and throws ENAMETOOLONG. Neither caller wraps the call in try/catch — POST /api/ideas (unauthenticated, cockpit/src/app/api/ideas/route.ts:30) and POST /api/capture (token-authed, cockpit/src/app/api/capture/route.ts:67) both surface this as an unhandled 500 instead of a 400. No path traversal is possible (the char class excludes '/' and '\\', and the basename is randomUUID()), and the saved files are never served by any route, so this is a malformed-input robustness gap only. Fix: cap the subtype length (e.g. <=10 chars) or allowlist known image extensions in the regex.

### [LOW] Fresh-DB restore can skip memory facts with forward mergedIntoId references
`cockpit/src/app/api/import/route.ts:61` · dimension: data-integrity

Import upserts data.facts in a single pass in export order. MemoryFact has a self-relation (schema.prisma:148-149, mergedIntoId FK), and pending merge proposals are exported with mergedIntoId set. On a fresh database (the 'new Mac' restore pitch in export/route.ts), a proposal row whose merge target appears LATER in the array fails the FK on create and is counted into `skipped` — the user sees only a skipped count, not which facts were dropped or why. Re-running the import a second time heals it (upsert), but nothing tells the user to do that. Other relations are safe (projects first, templates before prompts/ideas, sessions before iterations); only the MemoryFact self-relation has this ordering hole. The logic predates this diff, but the route was touched in this round (adrs + logActivity added) and round-trip restore is the feature's core promise. Fix: import facts in two passes (create without mergedIntoId, then patch it on), or topologically order.

### [LOW] Template save-after-run re-renders `original` from the live template at save time
`cockpit/src/app/api/templates/run/route.ts:60` · dimension: data-integrity

The new persist branch saves the reviewed output verbatim (good) and the client snapshots the VALUES that produced it (TemplateRunner.tsx lastRunValues ref), but the server recomputes `rendered` from the CURRENT template.body at save time and stores that as the Prompt's `original`. If the template body is edited between run and save (edit dialog in another tab — single user, but the app supports it), the saved row pairs an `optimized` output with an `original` prompt that never produced it, breaking the snapshot-the-inputs principle this round explicitly fixed elsewhere (email persists the exact body; bug-report persists the exact report). Fix: have the client send the rendered text it ran with, or accept it in the persist body.

### [LOW] Memory PATCH merge-accept branch bypasses the soft-delete (Trash) guard
`cockpit/src/app/api/memory/[id]/route.ts:38` · dimension: data-integrity

The generic update path enforces deletedAt:null (line 93-94: 'a generic PATCH must not silently re-status a fact that's sitting in the Trash'), but the merge-accept branch above it (body.status === "active" + mergedIntoId) does a findUnique with no deletedAt filter and then runs applyMerge — which EDITS the surviving active fact's value and HARD-DELETES the trashed proposal (memoryLoop.ts applyMerge $transaction). A PATCH {status:"active"} against a trashed merge-proposal therefore mutates an active fact and permanently destroys a restorable Trash row, violating both the soft-delete contract and the human-gated-accept spirit (the user trashed it, i.e. rejected it). Not reachable from the UI (Trash offers only restore/purge), so API-only; the branch predates this diff but was touched in it (projectId select + logActivity added). Fix: add deletedAt:null to the findUnique select/where.

### [LOW] Memory PATCH can empty a fact's value while keeping its stale embedding
`cockpit/src/app/api/memory/[id]/route.ts:82` · dimension: data-integrity

The new re-embed-on-edit logic guards with `typeof data.value === "string" && data.value`, so a value that trims to the empty string (line 60 `data.value = body.value.trim()` happily stores "") skips both branches and leaves the OLD embedding on the row — directly contradicting the adjacent comment 'never leave the stale vector in place'. An emptied fact then keeps relevance-ranking (rankFacts parses the vector regardless of value) and injecting an empty/blank line by its former meaning, and Reindex won't touch it (it only scans embedding:null). The MemoryManager UI blocks empty edits (saveEdit returns on !editValue.trim()), so this is raw-API only. Fix: reject empty values with a 400 (matching POST /api/memory), or null the embedding too.

### [LOW] Wrap-up routine files a project-attributed Idea built from ALL-projects activity — **FIXED in this audit**
`cockpit/src/lib/routines.ts:92` · dimension: data-integrity

This diff threads projectId into runRoutine (the palette passes the active project) and the resulting Idea is now created with that projectId (line 111) — but only the STANDUP branch scopes its queries (buildStandupBoard takes projectId). The wrapup branch still queries completed tasks, QA sessions, and activity log rows globally (lines 92-99, no projectId in any where clause). Result: a wrap-up Idea attributed to project X whose content summarizes every project's day — a data-attribution mismatch that then pollutes project X's brainstorm feed (the brainstorm page is now project-scoped in this same diff, so the misfiled row is visible there) and the project hub counts. Either scope the wrapup queries like standup, or file the wrapup Idea globally (projectId: null).

### [LOW] DailyBrief due-today list can silently miss tasks once 50+ earlier-due open tasks exist
`cockpit/src/components/DailyBrief.tsx:46` · dimension: data-integrity

The new single dueSoon query fetches not-done tasks with ANY due date, ordered dueDate asc, take:50, and derives overdue/due-today by calendar-day filtering in JS. If more than 50 open tasks are due before today (plausible with the 222-task LBMH pack if due dates get used), every due-TODAY task sorts past position 50 and the brief shows 'due today: none' with no hint of truncation — a proactive surface quietly under-reporting. The calendar-day comparison itself (dueDayString vs localDayString) is correct, including for legacy UTC-midnight rows. Fix: bound the query by date (dueDate < tomorrow's UTC-noon equivalent) instead of by row count, or run two queries like before but on day boundaries.

### [LOW] POST /api/ideas silently drops an unparseable image instead of erroring like capture
`cockpit/src/app/api/ideas/route.ts:30` · dimension: data-integrity

The new save-after-run ideas endpoint calls saveDataUrlImage, which returns null when the data URL doesn't match the base64 regex; the route then creates the Idea with imagePath:null and returns 200 — the user who clicked 'Save as idea' with an image on screen gets 'Saved' while the image was discarded. The sibling capture route treats the identical null as a 400 ('Unsupported image format.'). Low because the Image tool's FileReader always produces a well-formed base64 data URL, so this needs a hand-crafted request — but the inconsistency makes the failure invisible where capture makes it loud.

### [LOW] AGENTS.md (new) is written mac-only, contradicting the Windows support shipped in the same changeset
`AGENTS.md:17` · dimension: cross-platform-ops

The new Codex partner brief states 'Everything runs on the user's Mac' (line 7) and hard rule 1 reads 'Ollama runs natively on macOS, never in Docker' with only the macOS GPU rationale (line 17). It never mentions the Windows port landed in this same working tree (swiss.ps1, gemma4:12b GGUF quality tier, the MLX-is-Apple-Silicon-only trap, the rule that engine-down copy must stay platform-neutral because the cockpit runs in a Linux container). Since this file exists to brief a delegated implementation agent cold, the omission invites exactly the regressions this round fixed — e.g. reintroducing mac-only UI copy or treating 12b-mlx as the universal quality tier. CLAUDE.md's vision rule mentioned at AGENTS.md line 25 also names only `gemma4:12b-mlx` as the no-vision quality tier, omitting the GGUF `gemma4:12b` counterpart.

### [LOW] Usage comments in swiss.ps1, swiss.cmd, and swiss omit the new `setup` subcommand the README leads with
`swiss.ps1:4` · dimension: cross-platform-ops

README's 'Fastest path' makes `setup` the first command a new colleague runs, and Show-Usage/usage() list it, but the file-header synopses were not updated: swiss.ps1 lines 4-7 list only up/down/status/doctor, swiss.cmd line 4 says 'swiss up | down | status | doctor', and the bash `swiss` header lines 4-7 likewise. Someone reading the script header (the natural first stop on Windows before trusting an ExecutionPolicy-bypassing wrapper) won't see the entry-point command. Pure comment drift; one-line fixes in three files.

### [LOW] complexity.spec.ts engine-down mock still carries the old Mac-only health copy
`cockpit/e2e/complexity.spec.ts:83` · dimension: ux-consistency

The mocked 503 body in the engine-down test uses the pre-Windows-round copy "Start the Ollama app (open -a Ollama) and try again." The real assertOllamaReady (src/lib/health.ts:62) now returns the dual-platform message "(macOS: open -a Ollama · Windows: launch Ollama from the Start menu)". The assertion is loose (/ollama isn't running/i) so the test passes, but this is exactly the e2e mock-copy drift class that commit 00f8873 fixed elsewhere — the spec now documents copy the app no longer produces.

### [LOW] Favorites localStorage key duplicated as a string literal across SidebarNav and DashboardToolGrid
`cockpit/src/components/DashboardToolGrid.tsx:16` · dimension: ux-consistency

The favorites-first dashboard grid reads the literal "sk:nav:favorites" while SidebarNav defines its own `const FAV_KEY = "sk:nav:favorites"`. The values match today, but the coupling is invisible — renaming the key in one file silently breaks the star↔grid sync the feature exists for. Exporting the key from one place (e.g. lib/nav.tsx, the declared single source of truth for nav) would make the contract explicit.

### [LOW] backupCoverage tripwire is presence-only: it cannot catch a Trash-leak regression (the exact bug the last audit fixed) or a model dropped from the data payload
`cockpit/src/lib/backupCoverage.test.ts:35` · dimension: test-drift

Direct answers to the dimension questions: yes, backupCoverage.test.ts trips if a model's findMany is removed from /api/export (it derives the model list from prisma/schema.prisma and regex-asserts `prisma.<model>.findMany` in the export source and `m.<model>` in the import source), and it correctly trips on a NEW schema model that isn't added to backups. But it is a textual presence check with two holes. (1) It does not assert the `deletedAt: null` filter on the memoryFact read (export/route.ts:20) — the soft-delete Trash leak was a confirmed finding fixed in the hardening audit, and a refactor back to bare `prisma.memoryFact.findMany()` keeps every test green while re-leaking deleted facts into backups; grep shows zero tests anywhere (unit or e2e) reference deletedAt. (2) A findMany call left in place but whose result is dropped from the `data:` object (or destructured into the wrong position at export/route.ts:11) also passes. One extra regex line asserting `memoryFact.findMany\(\{ where: \{ deletedAt: null` would close the worst hole.

### [LOW] Engine-down 503 mocks in four specs carry the stale macOS-only error copy after the Windows-neutral health rewrite
`cockpit/e2e/eval-cases.spec.ts:90` · dimension: test-drift

lib/health.ts assertOllamaReady now returns "Ollama isn't running. Start the Ollama app (macOS: open -a Ollama · Windows: launch Ollama from the Start menu) and try again." (health.ts:60-62, changed in this diff), but the route mocks in eval-cases.spec.ts:90, code-review.spec.ts:61, complexity.spec.ts:82, and prompt-optimizer.spec.ts:64 still fulfill the old copy "Start the Ollama app (open -a Ollama) and try again.". Tests stay green because every assertion matches only the stable prefix (/ollama isn't running/i), so this is not a false pass today — but mock copy drift is the exact class confirmed as a real bug in the prior 25-agent review ("e2e mock copy drift"), and the four mocks no longer represent what the routes actually return. Anyone tightening an assertion to the full real copy will be testing against fiction. Cheap fix: hoist one shared OLLAMA_DOWN_503 fixture or trim the mocks' error strings to the asserted prefix.


## Completeness-critic additions

### [MEDIUM] Golden saved from a deep-linked session lands in a project the surrounding manager and bench never read
`cockpit/src/app/api/qa-pipeline/golden/route.ts:37`

The round's must-fix correctly attaches a golden to the SESSION's project (POST resolves session.projectId when sessionId is sent — QaSessionView now always sends it). But every read on the same screen stayed active-project scoped: GET /api/qa-pipeline/golden filters where {projectId: activeProject}, and POST /api/qa-pipeline/bench runs goldenCase.findMany({where:{projectId: activeProject}}). The exact flow the fix was built for — open a session from another project via a ⌘K deep link (?session=), click 'Save as golden' — shows a success toast, then 'Manage goldens' on the same page doesn't list it and 'Run eval bench' never scores it. To the user the save silently vanished; the golden only surfaces after switching the active project.

### [MEDIUM] New AGENTS.md instructs the partner agent to use the persist-in-onComplete pattern this same changeset killed
`AGENTS.md:26`

AGENTS.md is a brand-new file in this diff whose purpose is to steer Codex implementation work. Line 26 documents the AI-tool kit as: health-gate, then 'returns streamTextResponse({ messages, onComplete }) and persists in onComplete'. The headline architectural change of this very round ('Trust pattern killed everywhere') removed every persist-in-onComplete path — optimize, email, templates/run, and bug-report all moved to save-after-run persist branches precisely because onComplete-persist saves un-reviewed output. An agent following this brief on the next tool will reintroduce the anti-pattern the round eliminated. (Separately from the already-filed 'AGENTS.md is mac-only' finding.)

### [LOW] CLAUDE.md roadmap describes commits, a branch, and a merge that do not exist — the whole round is uncommitted on main
`CLAUDE.md:80`

Lines 79-80 state the production-ready round was 'Nine gated commits' on 'branch feat/production-ready' and that Windows support was 'Merged to `main` the same day'. Reality in this tree: `git branch -a` shows no feat/production-ready branch locally or on origin, HEAD is c78fc12, and the entire ~88-file round sits as uncommitted working-tree changes plus 23 untracked files. The promised rollback granularity (one gated commit per feature) does not exist, and the next session/agent reading CLAUDE.md will assume this work is committed and merged when none of it is. Notably, HEAD's own commit message is 'fix stale merge claim' — this re-introduces the same class of stale claim. A crash or errant `git checkout/clean` loses the whole round at once.

### [LOW] Board drag-to-done completions never reach the Activity timeline; only list/PATCH completions are logged
`cockpit/src/app/api/tasks/reorder/route.ts:36`

This round added `logActivity({entity:'task', action:'completed', ...})` to the tasks/[id] PATCH transition path, so checking a task done in list view writes an Activity row. The reorder route got the same completedAt transition-only fix but no logActivity call — dragging a card into Done on the Kanban board (the primary completion gesture on the board tab) stamps completedAt yet leaves no 'completed' activity. The Activity timeline and the wrapup's 'Captures' section (which reads activityLog) now systematically under-report board-driven completions while list-driven ones appear; wrapup's 'Completed today' bullet list is unaffected (it queries completedAt directly).

### [LOW] Bench agreement % still counts engine ERRORs as rubric drift despite the per-case 'ERROR (engine)' disambiguation
`cockpit/src/app/api/qa-pipeline/bench/route.ts:35`

The new per-case results table renders an ERROR verdict as a neutral 'ERROR (engine)' badge specifically so an engine hiccup doesn't read as drift (CLAUDE.md: 'engine ERRORs distinct from drift'). But the headline metric is computed before that distinction: a thrown scoreFeature sets got='ERROR', ok=false, and agreementPct = agree/cases.length — so one cold-load timeout on a 10-golden bench drops the displayed agreement from 100% to 90%, the exact false 'rubric drifted' signal the badge was added to prevent. ERROR cases should be excluded from (or separately reported in) the percentage denominator.

### [LOW] Image tool's new 'Save as idea' persists an image no surface can ever display (Idea.imagePath is write-only), and uploads are outside the backup escape hatch
`cockpit/src/app/tools/image/page.tsx:78`

The new saveAsIdea path POSTs the full data URL to /api/ideas, which writes the file under uploads/ and stores Idea.imagePath. But a repo-wide grep shows imagePath is referenced only in api/capture, api/ideas, and schema.prisma — no component (RecentItems on the brainstorm page is the only Idea surface) ever renders it. The user clicks 'Save as idea' on a screenshot Q&A, gets 'Saved as an idea', and the image is unreachable anywhere in the app; only the text answer survives visibly. Compounding it, /api/export (the documented machine-move escape hatch) exports the Idea row with its imagePath string but not the uploads/ binary, so image-attached ideas restore as dangling paths on a new machine. The compose round even added a cockpit-uploads volume to preserve these files that the UI never shows.


## Live walkthrough additions (main-loop persona testing)

- [LOW] QA pipeline no-pack card tells a fresh-clone colleague to run `npm run seed:lbmh`, but the pack content is gitignored ECI IP — the command no-ops for them. The flagship QA tool is a guided dead end out of the box; the card should also point at the Rubric Designer path or a generic pack.
- [LOW] Settings → Quick capture test command hardcodes `http://localhost:3000` — wrong origin when the cockpit runs on another port (e.g. dev on 3100). Derive from window.location.origin.
- [LOW] Settings → Backup & restore copy says "restore one on a new Mac" — survived the de-Mac pass; should be "a new machine".
- [LOW] ⌘/Ctrl-Enter runs the AiToolShell tools and the QA story box, but not Gherkin Lint / API Contract (custom pages) — muscle-memory inconsistency.
- [INFO] Tasks Board↔List persisted tab briefly flashes the server-rendered default before hydration applies the stored choice — inherent to the SSR-safe usePersisted pattern; cosmetic.

## Verified clean during this audit (gates + live)

- Gates on the fixed tree: lint clean · 249/249 unit · 81/81 e2e · production build compiles all 21 routes.
- Zero browser console errors/warnings across the full live walkthrough (every page, palette, mobile drawer, dark mode).
- Security probes live: SSRF baseUrl allowlist 400s 169.254.169.254; capture token header-only (correct token via query param → 401) and timing-safe; wrong token → 401.
- Export: includes all 11 models, excludes soft-deleted (Trash) facts — probed live.
- Quick-add NL → task with deterministic "tomorrow" date parse (UTC-noon storage, correct local display).
- Save-after-run persists the reviewed output verbatim (Prompt row matched the streamed text exactly).
- Memory: manual fact lands active + embedded on create; ⌘P project switcher; needsPack QA empty state; Inbox→Gherkin sessionStorage prefill; deterministic gates (Gherkin lint BLOCK, code-smell GATE BLOCK + growth WARN, Big-O scan-consistent, OpenAPI 3.1 paste-lint) all verified live on real Gemma.
---

# Round 2 — confidence raise (same day)

## Verifications executed (closing the certification gaps)

- **Docker layer (gap closed):** rebuilt the cockpit image from the fixed tree. `dev.db` is ABSENT from `/app/prisma` (only schema + seeds), and `TZ=America/New_York` reaches Node inside the container (`Intl` resolves it, wall clock is local). Both `.dockerignore` and TZ fixes proven end-to-end.
- **PowerShell (gap mostly closed):** ran `swiss.ps1` in the official PowerShell 7.4 arm64 container. Parse: 0 errors. The edited `Test-DockerUp`, executed under `$ErrorActionPreference = "Stop"` against a `docker` shim that reproduces a stopped Docker Desktop (stderr + exit 1), returned `False` with no crash. Full `status` and `doctor` ran end-to-end in the daemon-down state with the designed friendly diagnostics. Residual: Windows PowerShell 5.1 runtime itself is only reachable on real Windows — but the fix (function-local `EAP=Continue` + try/catch) removes the documented 5.1 failure mechanism by construction. An earlier crash on the `:latest` image was traced to arm32-under-qemu emulation, not the script.

## Round-2 fixes (all gated + live-verified)

- Eval Case Generator: verdict overrides cleared on regenerate (was silently relabeling goldens by index).
- ⌘K deep links: Tasks/Memory/Prompt Library sync the search box on prop change AND lift persisted filters/scope that masked the target. Verified live: a `priority=high` filter + project scope no longer hide a deep-linked task; same-page palette picks now update the box.
- Smart Inbox: lint verdict clears the moment the text is edited (verified live).
- Memory PATCH: empty value → 400; merge-accept honors the Trash (deletedAt:null); "accepted" activity logs only on a true pending → active flip (probed live: restore logs nothing, accept logs once).
- Golden PATCH: P2025 → 404, real DB errors → 500 (matches its DELETE).
- POST /api/ideas: unparseable `data:image` → 400 like capture (no more silent image loss).
- DailyBrief: due-date query bounded by DATE (`< local-noon+2d`) and ordered desc — due-today can no longer be starved by 50+ overdue rows.
- Growth WARNs (diff mode): require the diff to ADD iteration — context-line loops no longer blamed (new regression test).
- Big-O estimate: unified diffs are reconstructed to the new-file side before scan + model; hotspots mapped to new-file lines (deleted loops no longer count).
- Foreign-language detector: bare-`end`-line only — TS `end: number;` no longer flags the scan as Ruby (new regression test).
- Settings capture test command uses the live origin (was hardcoded :3000; verified :3100 in dev).
- QA no-pack card: honest guidance for colleagues without the private pack (Gherkin Lint / Rubric Designer standalone).
- AGENTS.md: persist-in-onComplete guidance corrected to save-after-run (the round's actual pattern; zero routes use onComplete persistence) + de-Mac'd.
- `setup` added to the usage headers of swiss / swiss.ps1 / swiss.cmd; DataBackup "new Mac" → "new machine".

## Gates after round 2

lint: No issues found · unit 251/251 (2 new regression tests) · build green · e2e 81/81 · `bash -n swiss` OK · `swiss.ps1` re-parse OK (pwsh 7.4 arm64).

## Still open (small, non-blocking)

- Test-coverage gaps (not behavior bugs): completedAt transition-only, save-after-run persist branches beyond optimizer, goldens-manager e2e, deep-link chain e2e.
- Product decisions for Ozzy: golden-from-deep-linked-session project visibility; board-drag completions absent from Activity; bench agreement % vs engine ERRORs; Image "Save as idea" images have no display surface; import ordering of forward `mergedIntoId` refs on a fresh-DB restore (re-run heals).
- CLAUDE.md describes this round as committed/merged — true once Ozzy commits.
- WinPS 5.1 smoke (`.\swiss doctor`, `.\swiss up`) on real Windows: now belt-and-suspenders, recommended anyway.
