# Architecture

ConsensFlow Pi is a Pi package for routing one natural-language prompt to one named participant.

It deliberately avoids the old ACP/shared-transcript model and avoids hidden workflow commands such as spec review, implementation review, council, grill, or handoff.

## Layers

```text
index.ts                         Pi API boundary: commands/tools/input interception
extensions/consensflow/lib/
  state.js                       global participant config + project artifact paths
  presets.js                     curated allowed participant presets
  packets.js                     scoped packet creation
  runners.js                     pi/claude/codex/opencode adapters
  workflows.js                   one-participant run helper
  artifacts.js                   git diff/artifact helpers
  image.js                       gpt-image-2 generation for image-kind participants
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

A prompt routes to a participant when it names exactly one — and the `@mention` can be anywhere, so `@zeus hi` and `hi @zeus` behave identically. A leading mention is an explicit address (it wins, and any other `@names` after it are kept as quoted text so you can paste a prior reply into the next prompt); a single mention elsewhere only routes when it matches a configured participant, so a stray `@types/node` in a prompt to the lead is left alone. Multiple leading mentions are rejected, and two different participants named with no leading mention is treated as ambiguous and left to the Pi lead. The user asks one participant, reads the answer, then decides whether to ask another or tell the Pi lead what to implement.

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
| `pi` | `pi --mode json --no-session --no-extensions --thinking off -p` by default | Skills stay enabled by default; JSON mode improves final-output parsing. Configure thinking per participant when needed. Read-only = `--tools read,grep,find,ls`. |
| `claude-code` | `claude -p ... --output-format json --no-session-persistence` | Read-only = `--allowedTools Read,Grep,Glob` plus `--disallowedTools Bash,Edit,...` (deny, so a user-level allowlist can't leak writes in). `ANTHROPIC_API_KEY` is stripped from the child env so runs ride the subscription login. |
| `codex` | `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules` plus `model_reasoning_effort` from preset | Uses sandbox mode (read-only is OS-enforced) and avoids user config/rules leaking hidden context. `OPENAI_API_KEY` is stripped so runs ride the ChatGPT login. |
| `opencode` | `opencode run --format json -f packet.md` | File-attached packet. OpenCode defaults to edit/bash `allow`, so read-only sets `OPENCODE_PERMISSION={"edit":"deny","bash":"deny"}` on the child env. |

Image participants (`kind: image`) don't use a CLI runner — they call the Codex Responses backend (gpt-image-2) over HTTP, reusing the openai-codex login (`ctx.modelRegistry`), and save a PNG artifact. They take the prompt only, never the session handoff.

Presets curate known-good model/effort combinations in `presets.js`; custom participants can supply any model string at creation. Either way the runtime passes the configured strings to the engine verbatim.

Current preset roster:

- House team: `zeus` / `apollo` (Claude Code Opus 4.8), `athena` (Codex GPT 5.5), `iris` (Pi GPT 5.5), `luna` (OpenCode Kimi K2.6)
- Fast tier: `hermod` (Claude Haiku), `loki` (Codex medium), `nike` (Pi Gemini Flash), `freya` (OpenCode DeepSeek Flash)
- Model zoo (same models, Greek = pi / Norse = opencode): DeepSeek V4 Pro `hades`/`odin`, Gemini 3.1 Pro `helios`/`heimdall`, Grok 4.3 `ares`/`thor`, Qwen3.7 Max `hephaestus`/`tyr`, Llama 4 Maverick `pan`/`vidar`, Mistral Large `aeolus`/`njord`, MiniMax M3 `metis`/`mimir`
- Image: `pygmalion` (kind=image) — gpt-image-2 via the Codex Responses backend, not a CLI
