# Architecture

ConsensFlow Pi is a Pi package for routing one natural-language prompt to one named participant.

It deliberately avoids the old ACP/shared-transcript model and avoids hidden workflow commands such as spec review, implementation review, council, grill, or handoff.

## Layers

```text
extensions/consensflow.ts        Pi API boundary: commands/tools/input interception
extensions/consensflow/lib/
  state.js                       global participant config + project artifact paths
  presets.js                     curated allowed participant presets
  packets.js                     scoped packet creation
  runners.js                     pi/claude/codex/opencode adapters
  workflows.js                   one-participant run helper
  artifacts.js                   git diff/artifact helpers
```

## State

Participant config is global/user-level, created from presets or custom definitions:

```text
~/.consensflow/participants.json
/cf participants presets
/cf participants add zeus|apollo|athena|iris|luna|all [--name <name>]
/cf participants add --name <name> --kind <kind> --model <model> [--roles <r>] [--tools <p>]
```

Run artifacts are workspace-local:

```text
<workspace>/.consensflow/runs/<run-id>/
```

## Prompt flow

```text
@zeus What do you think?   (or the dedicated /zeus command)
  -> input handler recognizes exactly one configured participant
  -> packet is written: identity + mode + session handoff + prompt
  -> runner launches the configured backend with its tools policy
     (read-only unless the participant is write-capable; advisory roles forced read-only)
  -> stdout/stderr/result are saved
  -> answer is shown in Pi
```

A prompt routes to a participant when it names exactly one — and the `@mention` can be anywhere, so `@zeus hi` and `hi @zeus` behave identically. A leading mention is an explicit address (it wins, and any other `@names` after it are kept as quoted text so you can paste a prior reply into the next prompt); a single mention elsewhere only routes when it matches a configured participant, so a stray `@types/node` in a prompt to the lead is left alone. Multiple leading mentions are rejected, and two different participants named with no leading mention is treated as ambiguous and left to the Pi lead. Gabriel asks one participant, reads the answer, then decides whether to ask another or tell the Pi lead what to implement.

## Subagent model

Internally, every participant is treated like a subagent:

- isolated child process
- packet with a one-shot session handoff (snapshot), not a live/shared Pi transcript
- explicit tool policy (configured; advisory roles coerced read-only)
- no memory between calls
- artifact output

This borrows the useful part of Pi subagents without adopting parallel fan-out as user-facing behavior.

## Runner policies

| Kind | Invocation | Notes |
|---|---|---|
| `pi` | `pi --mode json --no-session --no-extensions --thinking off -p` by default | Skills stay enabled by default; JSON mode improves final-output parsing. Configure thinking per participant when needed. |
| `claude-code` | `claude -p ... --output-format json --no-session-persistence` | Uses allowed tools. |
| `codex` | `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules` plus `model_reasoning_effort` from preset | Uses sandbox mode and avoids user config/rules leaking hidden context. |
| `opencode` | `opencode run --format json -f packet.md` | File-attached packet. |

Models are curated in `presets.js` rather than supplied during participant creation. Runtime still passes preset model strings through verbatim.

Current preset roster:

- `zeus` — Claude Code Opus 4.7 MAX
- `apollo` — Claude Code Opus 4.7 XHIGH
- `athena` — Codex GPT 5.5 XHIGH
- `iris` — Pi GPT 5.5 XHIGH
- `luna` — OpenCode Kimi K2.6 MAX
