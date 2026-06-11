# CLAUDE.md — ConsensFlow Pi

Guidance for Claude Code working in this directory. This is the sole ConsensFlow project (the older ACP-based `consensflow-cli/` was removed).

## What it is

A **Pi** (`@earendil-works/pi-coding-agent`) extension that routes one natural-language prompt to one named participant at a time. The participant runs as an isolated child coding-agent subprocess (`claude` / `codex` / `opencode` / `pi`), gets a packet (identity + mode + a handoff of the current session + your prompt), and returns an answer shown back in Pi. Think "calling an advisor": one-shot, no memory, but it sees a snapshot of the session.

- **How it works, end to end:** `README.md` (flow, packet contents, runner table, use cases, safety model).
- **Conventions, source map, invariants:** `AGENTS.md`. Read it before changing code.

## Working here

- **No local `node_modules` or `dist`.** Peer deps come from the host `pi` install; the `.ts` is transpiled and loaded by `pi` from source on each start (`pi list` shows the extension pointing at this dir). A fresh `pi` session picks up edits; a running one needs `/reload`.
- **Tests cover `lib/*.js` only**, not the `.ts`:
  ```bash
  npm test                                                            # node --test tests/*.test.mjs
  node --experimental-strip-types --check extensions/consensflow.ts   # syntax-check the .ts
  pi --no-extensions -e . --no-session --offline -p "ask @nope hi"    # headless load+route smoke (no model/auth)
  ```
  The smoke command exits cleanly — that proves the extension loads/registers (a transpile or registration break surfaces at `-e .` load time). `-p` headless mode does not render extension messages, and an unknown `@name` is now handled gracefully rather than thrown, so a clean exit is the pass signal, not a visible error. (It creates a stray `./.consensflow/`; `rm -rf` it after.)
- Keep changes in `lib/*.js` testable; the only TS is `extensions/consensflow.ts`.

## Load-bearing facts (easy to get wrong)

- `ctx.sessionManager.getBranch()` returns entries **root→leaf (oldest first) — do not reverse**. The `.d.ts` comment is misleading; verified in the host's `session-manager.js`.
- **Never add a new runtime import of `@earendil-works/pi-coding-agent`** — read the transcript via the `ctx.sessionManager` methods already provided. (Type-only imports are fine.)
- Advisory roles (`reviewer`/`council`/`knowledge`) are forced read-only by `effectiveToolsPolicy`; write flags must never reach them.
- Any subprocess `--cwd` must validate as nested inside the workspace before spawning (`resolveInside`).
- Participant replies persist as `custom_message` entries (not normal messages) and are surfaced into later participants' handoffs (cross-pollination).
- Consent gate: the lead consults participants freely, but never acts on a participant's response or keeps a write-capable participant's file edits without user approval (unless pre-authorized). Source of truth: `cf_run_participant` description/promptSnippet, `skills/consensflow/SKILL.md`, and `prompts/cf-ask.md` — don't weaken one without the others.

## Audience

Solo-use today (single user). Keep it clean enough to externalize cheaply, but skip distribution infra (multi-OS installers, telemetry, i18n) until there's a real second user.

## Knowledge base

Read/write the **ngvoicu-sme** brain via the `/kluris-ngvoicu-sme` skill (never edit brain files by hand). Kluris is never bundled — brain features shell out to a separately-installed `kluris` CLI and degrade gracefully when it's absent.
