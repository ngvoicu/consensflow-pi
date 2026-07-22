# Architecture

ConsensFlow Pi is a Pi package for routing one natural-language prompt to one named participant.

It deliberately avoids hidden workflow commands such as spec review, implementation review, council, grill, or handoff.

## Layers

```text
index.ts                         Pi API boundary: commands/tools/input interception
extensions/consensflow/lib/
  state.js                       global participant config + project artifact paths
  presets.js                     curated allowed participant presets
  packets.js                     scoped packet creation
  runners.js                     pi/claude/codex/opencode adapters
  workflows.js                   one-participant run helper
  image.js                       gpt-image-2 generation for image-kind participants
```

## State

Participant config is global/user-level and shared across Pi and Claude Code. The canonical roster is:

```text
~/.consensflow/participants.json
```

There are no per-tool config roots. Create entries from presets or custom definitions:

```text
/consensflow:presets
/consensflow:participants add <preset>|all [--name <name>]
/consensflow:participants add --name <name> --kind <kind> --model <model> [--tools <p>]
```

Run artifacts are workspace-keyed under the config home — never inside the project:

```text
~/.consensflow/workspaces/<workspace>-<hash>/runs/<run-id>/
```

## Prompt flow

```text
@zeus What do you think?   (or /consensflow:cf @zeus What do you think?)
  -> input handler or namespaced command recognizes exactly one configured participant
  -> packet is written: identity + mode + session handoff + prompt
  -> runner launches the configured backend with its tools policy
     (default workspace-write — read/edit/run confined to the project workspace; `--tools full-auto` is the only escalation)
  -> stdout/stderr/result are saved
  -> answer is shown in Pi
```

A prompt routes to a participant when it names exactly one — and the `@mention` can be anywhere, so `@zeus hi` and `hi @zeus` behave identically. A leading mention is an explicit address (it wins, and any other `@names` after it are kept as quoted text so you can paste a prior reply into the next prompt); a single mention elsewhere only routes when it matches a configured participant, so a stray `@types/node` in a prompt to the lead is left alone. Multiple leading mentions are rejected, and two different participants named with no leading mention is treated as ambiguous and left to the Pi lead. The user asks one participant, reads the answer, then decides whether to ask another or tell the Pi lead what to implement.

## Subagent model

Internally, every participant is treated like a subagent:

- isolated child process
- packet with a one-shot session handoff (snapshot)
- explicit tool policy (configured; missing policy means default workspace-write)
- no memory between calls
- artifact output

This borrows the useful part of Pi subagents without adopting parallel fan-out as user-facing behavior.

## Runner policies

| Kind | Invocation | Notes |
|---|---|---|
| `pi` | `pi --mode json --no-session --no-extensions --thinking off -p` by default | Skills stay enabled by default; JSON mode improves final-output parsing. Configure thinking per participant when needed. Gets full tools (read/edit/run) at the default workspace-write policy; `--tools full-auto` escalates past the engine's checks. |
| `claude-code` | `claude -p ... --output-format json --no-session-persistence` | Runs with full read-write tools (no deny list) at the default workspace-write policy; `--tools full-auto` escalates past the engine's approval checks. `ANTHROPIC_API_KEY` is stripped from the child env so runs ride the subscription login. |
| `codex` | `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules` plus `model_reasoning_effort` from preset | Runs read-write at the default workspace-write policy (no read-only sandbox); `--tools full-auto` escalates past the engine's sandbox. Avoids user config/rules leaking hidden context. `OPENAI_API_KEY` is stripped so runs ride the ChatGPT login. |
| `opencode` | `opencode run --format json -f packet.md` | File-attached packet. OpenCode runs with its default edit/bash `allow` (no permission deny overlay) at the workspace-write policy; `--tools full-auto` escalates past the engine's checks. |

Image participants (`kind: image`) don't use a CLI runner — they call the Codex Responses backend (gpt-image-2) over HTTP, reusing the openai-codex login (`ctx.modelRegistry`), and save a PNG artifact. They take the prompt only, never the session handoff.

Presets curate known-good model/effort combinations in `presets.js`; custom participants can supply any model string at creation. Either way the runtime passes the configured strings to the engine verbatim.

Current preset roster (default workspace-write read-write tools; each model+effort family on every engine that runs it):

- Fable 5: `calliope`/`clio`/`euterpe`/`thalia` (claude-code max/xhigh/high/medium), `orpheus`/`linus`/`erato` (pi xhigh/high/medium, Anthropic provider), `saga`/`gunnlod`/`kvasir` (opencode xhigh/high/medium via OpenRouter)
- Opus 4.8: `zeus`/`apollo`/`artemis` (claude-code max/xhigh/medium), `kronos`/`atlas` (pi xhigh/medium, Anthropic provider), `baldr`/`vali` (opencode xhigh/medium via OpenRouter — xhigh is the effort ceiling everywhere outside claude-code)
- GPT 5.6: `hyperion`/`phoebus` (codex sol ultra/xhigh), `gaia` (codex terra xhigh), `diana` (codex luna xhigh), `aether`/`rhea`/`phoebe` (pi sol/terra/luna xhigh via the openai-codex login), `sunna`/`jord`/`bil` (opencode sol/terra/luna xhigh via OpenRouter)
- Deep open-weights: Kimi K2.7 Code — `luna` (opencode), `daedalus` (pi craftsman preset), `selene` (pi moon-goddess alias; both Pi presets use high thinking)
- Fast tier: `hermod` (Claude Haiku), `nike`/`sif` (Gemini Flash on pi/opencode), `zephyros`/`freya` (DeepSeek Flash on pi/opencode)
- Model zoo (same models, Greek = pi / Norse = opencode): DeepSeek V4 Pro `hades`/`odin`, Gemini 3.1 Pro `helios`/`heimdall`, Grok 4.3 `ares`/`thor`, Qwen3.7 Max `hephaestus`/`tyr`, Llama 4 Maverick `pan`/`vidar`, Mistral Large `aeolus`/`njord`, MiniMax M3 `metis`/`mimir`, GLM 5.2 `prometheus` (pi only)
- Image: `pygmalion` (kind=image) — gpt-image-2 via the Codex Responses backend, not a CLI
