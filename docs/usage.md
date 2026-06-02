# Usage

ConsensFlow Pi uses natural-language prompts to one named participant at a time.

## Add participants

Participants are stored globally in `~/.consensflow/participants.json`. Add them from a preset, rename a preset, or define a fully custom participant.

```text
/cf participants presets
/cf participants add zeus                     # from a preset
/cf participants add zeus --name Deepreview   # preset backend, custom name (-> @deepreview, /deepreview)
/cf participants add all                      # every preset
/cf participants add --name Builder --kind codex --model gpt-5.5 --effort high \
    --roles implementer --tools workspace-write   # fully custom, write-capable
```

Preset map:

- **House team** (one reviewer per engine): `zeus`/`apollo` (Claude Code Opus 4.8), `athena` (Codex GPT 5.5), `iris` (Pi GPT 5.5), `luna` (OpenCode Kimi K2.6).
- **Fast tier**: `hermod` (Claude Haiku), `loki` (Codex medium), `nike` (Pi Gemini Flash), `freya` (OpenCode DeepSeek Flash).
- **Model zoo** (same OpenRouter models, Greek = pi / Norse = opencode): DeepSeek V4 Pro `hades`/`odin`, Gemini 3.1 Pro `helios`/`heimdall`, Grok 4.3 `ares`/`thor`, Qwen3.7 Max `hephaestus`/`tyr`, Llama 4 Maverick `pan`/`vidar`, Mistral Large `aeolus`/`njord`, MiniMax M3 `metis`/`mimir`.

Run `/cf participants presets` for the full list with exact model strings.

Add options — preset path: `--name`, `--id`, `--cwd`, `--timeoutMs`, `--description`. Custom path also accepts `--kind`, `--model`, `--provider`, `--effort`/`--thinking`, `--roles`, `--tools`, `--skills`, `--agent`, `--maxTurns`. A `workspace-write`/`full-auto` participant can edit and run; participants whose roles are purely advisory (reviewer/council/knowledge) are always read-only.

## Ask directly

Each participant has its own command (`/<name>`); a bare mention or the generic router also work.

```text
/zeus What do you think about this approach?
@zeus What do you think about this approach?
/cf @athena Review the latest changes and tell me only blockers.
```

## Ask for questions

There is no special grill command. Ask naturally:

```text
@iris What questions should Gabriel answer before implementing this?
```

## Review latest changes

```text
@luna Review the latest changes and list blockers, test gaps, and risky assumptions.
```

When the prompt mentions latest changes/diff/patch/implementation, ConsensFlow includes git status/diff context when available.

## One-at-a-time comparison

```text
@zeus What do you think about this design?
```

Then, after Zeus answers:

```text
@apollo Zeus said X. Do you agree or disagree, and why?
```

ConsensFlow rejects prompts with multiple leading participant mentions because it should not silently choose serial or parallel fan-out.
