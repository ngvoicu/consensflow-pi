# AGENTS.md — ConsensFlow Pi

Pi-native ConsensFlow package — the sole project in this workspace. (The earlier ACP-based `consensflow-cli/` has been removed; do not reintroduce its architecture.)

## What this is

A Pi package containing a TypeScript extension, prompt template, and skill for routing a natural-language prompt to one named participant at a time. It is installed into `pi` as a local extension (`pi list` shows it pointing at this directory) and loaded from source on each start.

Core direction:

- The current Pi session is the lead/spec creator/implementer.
- ConsensFlow is a lightweight prompt router, not a shared room.
- Named participants are ephemeral one-shot subagent calls (no memory between calls).
- Each call's packet embeds a serialized, capped handoff of the current session plus the prompt; participants stay isolated one-shot subprocesses — no live/shared transcript, no ACP.
- Participant config is global/user-level under `~/.consensflow/consensflow-pi/participants.json` (per-tool store; the Claude Code sibling `consensflow-cc` keeps its own same-format roster under `~/.consensflow/consensflow-cc/`).
- Participants come from curated presets (`extensions/consensflow/lib/presets.js`, renameable via `--name`) or fully custom definitions (`/cf participants add --name … --kind … --model … --roles … --tools …`).
- Each configured participant gets a dedicated `/<id>` command (registered at load); `@mention` and `/cf @name` also work.
- Run artifacts are stored per workspace under the config home (`~/.consensflow/consensflow-pi/workspaces/<dir>-<hash>/`); ConsensFlow never creates a directory inside the project.
- No hidden workflows: no spec-review command, no implementation-review command, no grill command, no council/fan-out by default.

## Source layout

- `index.ts` — the only TypeScript file and the extension entry (root `index.ts` so pi's extension list shows the bare package name): extension factory (event handlers, `/cf` + per-participant commands, the `cf_*` tools), input routing, `collectHandoff`, and packet wiring. Loaded and transpiled by the host `pi` (no local build).
- `extensions/consensflow/lib/*.js` — plain JS, the unit-tested core:
  - `presets.js` — preset catalog + `participantFromPreset` (supports `--name`/`--id` rename).
  - `state.js` — global participant store + `normalizeParticipant` (validates kind/roles/policies).
  - `packets.js` — `createPacket` (conversational, mode-aware, handoff + prompt).
  - `handoff.js` — `serializeTranscript` (root→leaf, compaction-aware, byte-capped) + `custom_message` cross-pollination.
  - `workflows.js` — `effectiveToolsPolicy` (advisory→readonly guard) + `runNamedParticipant`.
  - `runners.js` — per-engine invocation (`pi`/`claude-code`/`codex`/`opencode`) + output normalization + spawn/timeout.
  - `image.js` — `image`-kind generation: Codex Responses backend → gpt-image-2 (HTTP/SSE) + base64→PNG save. Pure helpers unit-tested.
  - `utils.js` — tokenize/slugify/path-validation helpers (`resolveInside` is realpath-checked).
- `skills/consensflow/SKILL.md`, `prompts/cf-ask.md`, `docs/`, `tests/core.test.mjs`.

## Commands & verify

```bash
npm test                       # node --test tests/*.test.mjs  (lib only; .ts is not compiled here)
npm run check                  # alias for npm test
node --experimental-strip-types --check index.ts                    # syntax-check the .ts
pi --no-extensions -e . --no-session --offline -p "ask @nope hi"    # headless load+route smoke (no model/auth)
```

There is no local `node_modules` or `dist` — peer deps come from the host `pi` install. The smoke command proves the extension loads and registers (a transpile or registration break surfaces at `-e .` load time). It exits cleanly: `-p` headless mode does not render extension messages, and an `ask @name` to an unknown participant is now handled gracefully rather than thrown (the consent/error path), so a clean exit — not a visible "Unknown participant" — is the pass signal.

## Conventions

- Keep the router lightweight: the handoff is a one-shot serialized snapshot built on-demand from `ctx.sessionManager`, embedded in the packet — never a streamed/shared/live session or an ACP-style shared transcript.
- Build the handoff with a hard byte cap (keep the tail) and **never add a new runtime import of the host `@earendil-works/pi-coding-agent` package** — read the transcript via the `ctx.sessionManager` methods already provided (`getBranch()`, `getLeafId()`).
- `ctx.sessionManager.getBranch()` returns entries **root→leaf (oldest first) — do not reverse it.** (Verified in the host's `session-manager.js`, which `unshift`es while walking up; the `.d.ts` comment "walk to root, in path order" is misleading.)
- Cross-pollination: participant replies persist as `custom_message` entries (not normal messages); `serializeTranscript` surfaces ConsensFlow ones so later participants' handoffs include earlier `@participant` exchanges. The triggering prompt is carried in the message `details` because the `@mention` input is "handled" and never stored as a normal message.
- Custom participant creation is supported; model/effort strings pass through to the runtime verbatim. Validation lives in `normalizeParticipant` (state.js).
- Send to one participant at a time; reject multiple leading mentions unless the product direction changes explicitly.
- Participants should respond to the user's prompt as written; do not inject terms like grill/handoff/spec-review unless the user used them.
- Participants run with their configured tools. `effectiveToolsPolicy` (workflows.js) forces read-only when roles are purely advisory (reviewer/council/knowledge) — advisory roles must never receive write flags. Enforcement is per engine (runners.js): codex `--sandbox read-only` (OS-level), claude `--allowedTools` + `--disallowedTools` deny list, pi `--tools` allowlist, opencode `OPENCODE_PERMISSION={"edit":"deny","bash":"deny"}` env (its defaults are allow). Claude/codex children also get `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` stripped so runs stay on the subscription logins.
- Consent gate: consulting a participant is free and proactive, but the lead must never apply/keep a participant's response — or a write-capable participant's file edits — without explicit user approval, unless pre-authorized. The gate lives in `cf_run_participant`'s description/promptSnippet, `skills/consensflow/SKILL.md`, and `prompts/cf-ask.md`; keep them in sync when changing it.
- Image participants (`kind: image`) bypass the CLI runner: handled in `index.ts` (`runImageParticipant`/`generateImageArtifact`), which calls `image.js` with the `openai-codex` token from `ctx.modelRegistry` (a ctx method, not a host import — the no-host-import rule stays intact). They get the prompt only (no packet/handoff), save a PNG under the run dir, and render inline via an image content block. `buildRunnerInvocation` throws on `image` as a loud backstop so it can never silently reach the CLI path.
- Pi participants use `--mode json --no-session --no-extensions`; do not add `--no-skills` by default.
- Keep command paths real end-to-end; no reachable stubs (tests exercise `lib/*.js`; the `.ts` is validated by the smoke command above).
