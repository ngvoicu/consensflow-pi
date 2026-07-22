# CLAUDE.md — ConsensFlow Pi

Guidance for Claude Code working in this directory. This is the Pi-native ConsensFlow project; its Claude Code sibling is `../consensflow-cc/`, kept in parity. (The older `consensflow-cli/` was removed.)

## What it is

A **Pi** (`@earendil-works/pi-coding-agent`) extension that routes one natural-language prompt to one named participant at a time. The participant runs as an isolated child coding-agent subprocess (`claude` / `codex` / `opencode` / `pi`), gets a packet (identity + mode + a handoff of the current session + your prompt), and returns an answer shown back in Pi. Think "calling an advisor/helper": one-shot, no memory, but it sees a snapshot of the session.

- **How it works, end to end:** `README.md` (flow, packet contents, runner table, use cases, safety model).
- **Conventions, source map, invariants:** `AGENTS.md`. Read it before changing code.

## Working here

- **No local `node_modules` or `dist`.** Peer deps come from the host `pi` install; the `.ts` is transpiled by `pi` at load time (no build step).
- **Interactive `pi` does NOT load this checkout.** The extension is installed as a git package from https://github.com/ngvoicu/consensflow-pi — `pi list` shows the URL, and `pi` loads from its own clone at `~/.pi/agent/git/github.com/ngvoicu/consensflow-pi`. Local edits reach interactive sessions only after: commit → push `upstream main` (GitHub) → `pi update https://github.com/ngvoicu/consensflow-pi` (or `pi update --all`) → new session (a running one needs `/reload`). To test unpushed edits, use the headless smoke command below (`-e .` loads from this dir), or install from the local clone instead (see README "Or install from a local clone").
- **Tests cover `lib/*.js` only**, not the `.ts`:
  ```bash
  npm test                                                            # node --test tests/*.test.mjs
  node --experimental-strip-types --check index.ts                    # syntax-check the .ts
  pi --no-extensions -e . --no-session --offline -p "ask @nope hi"    # headless load+route smoke (no model/auth)
  ```
  The smoke command exits cleanly — that proves the extension loads/registers (a transpile or registration break surfaces at `-e .` load time). `-p` headless mode does not render extension messages, and an unknown `@name` is now handled gracefully rather than thrown, so a clean exit is the pass signal, not a visible error. (Run artifacts land under `~/.consensflow/workspaces/…`, never in the project.)
- Keep changes in `lib/*.js` testable; the only TS is the root `index.ts` entry.

## Load-bearing facts (easy to get wrong)

- `ctx.sessionManager.getBranch()` returns entries **root→leaf (oldest first) — do not reverse**. The `.d.ts` comment is misleading; verified in the host's `session-manager.js`.
- **Never add a new runtime import of `@earendil-works/pi-coding-agent`** — read the transcript via the `ctx.sessionManager` methods already provided. (Type-only imports are fine.)
- Participants live in the shared roster `~/.consensflow/participants.json`; both host tools use it. If the shared roster is missing, `state.js` performs a one-time migration from old per-tool rosters before treating the root file as authoritative.
- Participants run as standard read-write CLI calls (read, edit files, run commands) — like running `claude`/`codex`/`pi`/`opencode` yourself. A missing/default tools policy resolves to `workspace-write` (write-capable, confined to the project workspace); `full-auto` is the only escalation (bypasses the engine's sandbox/approval checks). There is no `readonly` tier.
- Any subprocess `--cwd` must validate as nested inside the workspace before spawning (`resolveInside`).
- Participant replies persist as `custom_message` entries (not normal messages) and are surfaced into later participants' handoffs (cross-pollination).
- Consent gate: the lead consults participants freely, but never acts on a participant's response or keeps a participant's file edits without user approval (unless pre-authorized). Source of truth: `cf_run_participant` description/promptSnippet and `skills/consensflow/SKILL.md` — don't weaken one without the other.

## Audience

Solo-use today (single user). Keep it clean enough to externalize cheaply, but skip distribution infra (multi-OS installers, telemetry, i18n) until there's a real second user.

## Knowledge base

Read/write the **ngvoicu-sme** brain via the `/kluris-ngvoicu-sme` skill (never edit brain files by hand). Kluris is never bundled — brain features shell out to a separately-installed `kluris` CLI and degrade gracefully when it's absent.
