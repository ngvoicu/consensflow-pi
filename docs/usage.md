# Usage

ConsensFlow Pi uses natural-language prompts to one named participant at a time.

## Add participants

Participants are stored in the shared roster `~/.consensflow/participants.json`, used by both consensflow-pi and consensflow-cc. Add a participant in either tool and it is visible in the other. There are no per-tool config roots.

```text
/consensflow:presets
/consensflow:participants add zeus                     # from a preset
/consensflow:participants add daedalus                 # Pi-backed Kimi K2.7 Code (-> @daedalus)
/consensflow:participants add zeus --name Deepreview   # preset backend, custom name (-> @deepreview)
/consensflow:participants add all                      # every preset
/consensflow:participants add --name Builder --kind codex --model gpt-5.5 --effort high \
    --tools workspace-write                           # fully custom, write-capable
```

Preset map (each model+effort family on every engine that runs it):

- **Fable 5**: `calliope`/`clio`/`euterpe`/`thalia` (claude-code max/xhigh/high/medium), `orpheus`/`linus`/`erato` (pi xhigh/high/medium), `saga`/`gunnlod`/`kvasir` (opencode xhigh/high/medium).
- **Opus 4.8**: `zeus`/`apollo`/`artemis` (claude-code max/xhigh/medium), `kronos`/`atlas` (pi xhigh/medium), `baldr`/`vali` (opencode xhigh/medium).
- **GPT 5.5**: `athena`/`perseus`/`loki` (codex xhigh/high/medium), `iris`/`hermes`/`eos` (pi xhigh/high/medium), `forseti`/`bragi`/`ullr` (opencode xhigh/high/medium).
- **Deep open-weights**: Kimi K2.7 Code — `luna` (opencode), `daedalus` (pi craftsman preset), `selene` (pi moon-goddess alias; both Pi presets use high thinking).
- **Fast tier**: `hermod` (Claude Haiku), `nike`/`sif` (Gemini Flash on pi/opencode), `zephyros`/`freya` (DeepSeek Flash on pi/opencode).
- **Model zoo** (same OpenRouter models, Greek = pi / Norse = opencode): DeepSeek V4 Pro `hades`/`odin`, Gemini 3.1 Pro `helios`/`heimdall`, Grok 4.3 `ares`/`thor`, Qwen3.7 Max `hephaestus`/`tyr`, Llama 4 Maverick `pan`/`vidar`, Mistral Large `aeolus`/`njord`, MiniMax M3 `metis`/`mimir`.
- **Image**: `pygmalion` (kind=image) — generates a picture with gpt-image-2 via your openai-codex login.

Run `/consensflow:presets` for the full list with exact model strings.

Add options — preset path: `--name`, `--id`, `--cwd`, `--timeoutMs`, `--description`. Custom path also accepts `--kind`, `--model`, `--provider`, `--effort`/`--thinking`, `--tools`, `--skills`, `--agent`, `--maxTurns`. Participants use default safe mode (no write tools) unless you pass `--tools workspace-write` or `full-auto` (then they can edit and run).

## Ask directly

Use a bare mention or the Claude Code-style `/consensflow:cf` router. Pi intentionally registers only `/consensflow:*` slash commands, not unnamespaced shortcuts or per-participant slash commands.

```text
@zeus What do you think about this approach?
/consensflow:cf @athena Review the auth flow in src/login.ts and tell me only blockers.
/consensflow:cf @builder Make the minimal fix --rw
/consensflow:cf @builder Make the minimal fix --tools workspace-write
```

## Ask for questions

There is no special grill command. Ask naturally:

```text
@iris What questions should I answer before implementing this?
```

## Review a diff

Participants don't get your git state automatically — paste the relevant diff (or name the files) in the prompt:

```text
@luna Review this diff and list blockers, test gaps, and risky assumptions: [paste git diff output]
```

## One-at-a-time comparison

```text
@zeus What do you think about this design?
```

Then, after Zeus answers:

```text
@apollo Zeus said X. Do you agree or disagree, and why?
```

ConsensFlow rejects prompts with multiple leading participant mentions because it should not silently choose serial or parallel fan-out.
