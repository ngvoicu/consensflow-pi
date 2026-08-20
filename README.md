> **Merged into [ngvoicu/consensflow](https://github.com/ngvoicu/consensflow) on 2026-08-20.**
> This repository is archived. Its payload and engine now live in that repo
> (`hosts/pi` and the shared `hosts/lib`), and it is installed
> with `npm install -g ngvoicu/consensflow` then `consensflow install pi`.
> History is kept here; changes happen there.

# ConsensFlow Pi

Ask other AI coding agents — **Claude Code, Codex, Pi, OpenCode** — for a second opinion, **one at a time, by name**, without leaving your Pi session.

---

## What is it? (the 30-second version)

You're coding with **Pi**, your main AI assistant. Sometimes you want another model's take — maybe Claude is sharper on architecture, you want Codex to sanity-check a diff, or a cheap fast model for a quick gut-check.

ConsensFlow lets you keep a roster of **participants**. A participant is just *one specific AI agent + model* that you've set up and given a name — like `@zeus` or `@gaia`. When you want one's opinion, you `@mention` it right in your Pi chat. ConsensFlow then:

1. packages a snapshot of your current conversation (the **handoff**) plus your question,
2. runs that agent in an isolated subprocess as a **one-shot** (your session stays usable),
3. and shows you its answer.

Think of it as a bench of advisors/helpers on speed-dial. **You stay in charge** (you're "the lead") — they advise, and you decide what to keep. It is **not** a group chat, not parallel fan-out, not a fixed workflow. One question → one participant → one answer, every time.

The whole idea in five bullets:

- **Participant** = a named *(agent + model)* combo. Configure once, reuse from any project.
- **One at a time.** `@zeus @gaia …` is rejected — ask one, read, then ask the next.
- **One-shot, but context-aware.** Each call is fresh (no memory of past calls), yet it always receives the current session handoff — *including earlier participants' answers* — so the 2nd agent you ask can build on the 1st.
- **The lead can ask too — and asks before applying.** Pi will consult a participant on its own initiative when a second opinion would help, then report back and get your go-ahead before applying anything — unless you pre-authorized it (e.g. "get Zeus's take and apply what makes sense").

---

## How it works — the flow, top to bottom

```text
You, in your Pi session
   │   type:  @zeus what's the riskiest part of this design?
   ▼
ConsensFlow sees exactly one @mention  →  intercepts the message
   │
   ▼
It builds a "packet" for @zeus:
   • who @zeus is        (claude-code · claude-opus-5 · max)
   • tools line         
   • handoff             (a snapshot of THIS session + earlier @participant replies)
   • your question
   ▼
Runs @zeus as an isolated, one-shot subprocess:
   claude -p … --model claude-opus-5 --effort max   (workspace-write by default)
   no memory of past calls, no live access to your session — just the packet
   ▼
Saves everything as an artifact:
   ~/.consensflow/workspaces/<workspace>/runs/<run-id>/{packet.md, stdout.txt, stderr.txt, result.json}
   ▼
Shows @zeus's answer back in your Pi session
   ▼
You (the lead) decide what to do:
   ask another participant (it will see this answer) · implement it · ignore it
```

That's the entire loop — no hidden steps, no background fan-out.

---

## Install

**Prerequisites**

- **Pi** itself (`@earendil-works/pi-coding-agent`) — you already have it if you're reading this.
- The **CLI for each engine you want to use**, on your `PATH`. You only need the ones you'll actually configure:

  | Engine | CLI |
  |---|---|
  | Claude Code | `claude` |
  | Codex | `codex` |
  | OpenCode | `opencode` |
  | Pi | `pi` (already there) |

**Install the extension** — straight from GitHub:

```bash
pi install https://github.com/ngvoicu/consensflow-pi
```

Pi clones the repo and registers it in your user-level settings, so it's available in every Pi session. Start a new session (or restart Pi) to load it. Get newer versions later with `pi update`.

**Or install from a local clone** (for development — your edits are picked up live):

```bash
git clone https://github.com/ngvoicu/consensflow-pi
pi install ./consensflow-pi
```

**Verify**

```text
/consensflow:doctor       # shows which engine CLIs are installed and working
/consensflow:status       # shows your configured participants
```

**Uninstall** any time with `pi remove <source>` (the same URL or path you installed) — your participant config is left untouched.

---

## Updating

A new ConsensFlow release ships a new preset catalog — new models, retired ones, bumped effort tiers. Updating the extension does **not** touch participants you already added: each roster entry keeps the model it was created with. `participants sync` re-resolves them against the current catalog.

```bash
pi update --extension https://github.com/ngvoicu/consensflow-pi   # or: pi update --extensions
```

Then, in a reloaded Pi session (`/reload`):

```text
/consensflow:participants sync --dry-run   # preview — prints exactly what would change
/consensflow:participants sync             # apply
```

Sync rewrites only the fields a preset owns: kind, model, effort/thinking, and tool policy. Your rename (`--name`), per-participant `--cwd`, and any custom `--description` survive it; fully custom participants (no preset) and participants whose preset has left the catalog are left alone and reported. `/consensflow:status` and `/consensflow:participants` flag "N behind the catalog" when a participant is out of date, so you don't have to remember.

Because both hosts share one roster, syncing in either place upgrades it for both.

## How to use

### Step 1 — Configure a participant

Two ways: start from a **preset** (curated, known-good combos) or define a **custom** one (any engine + any model).

See the presets:

```text
/consensflow:presets
```

All presets in one view. The same model+effort family appears on **every tool that runs it**, so you can compare how different harnesses drive the same model. Effort means `--effort` on claude-code/codex, the `--thinking` level on pi, and the `--variant` on opencode.

Sorted by model, then effort (strongest first). Claude Fable 5, Claude Opus 5, and GPT 5.6 lead; the rest are alphabetical.

| Preset | Tool | Model | Effort |
|---|---|---|---|
| `@calliope` | claude-code | `claude-fable-5` | max |
| `@clio` | claude-code | `claude-fable-5` | xhigh |
| `@orpheus` | pi | `anthropic/claude-fable-5` | xhigh |
| `@saga` | opencode | `openrouter/anthropic/claude-fable-5` | xhigh |
| `@euterpe` | claude-code | `claude-fable-5` | high |
| `@linus` | pi | `anthropic/claude-fable-5` | high |
| `@gunnlod` | opencode | `openrouter/anthropic/claude-fable-5` | high |
| `@thalia` | claude-code | `claude-fable-5` | medium |
| `@erato` | pi | `anthropic/claude-fable-5` | medium |
| `@kvasir` | opencode | `openrouter/anthropic/claude-fable-5` | medium |
| `@zeus` | claude-code | `claude-opus-5` | max |
| `@apollo` | claude-code | `claude-opus-5` | xhigh |
| `@kronos` | pi | `anthropic/claude-opus-5` | xhigh |
| `@baldr` | opencode | `openrouter/anthropic/claude-opus-5` | xhigh |
| `@artemis` | claude-code | `claude-opus-5` | medium |
| `@atlas` | pi | `anthropic/claude-opus-5` | medium |
| `@vali` | opencode | `openrouter/anthropic/claude-opus-5` | medium |
| `@hermod` | claude-code | `claude-haiku-4-5` | low |
| `@zephyros` | pi | `openrouter/deepseek/deepseek-v4-flash` | low |
| `@freya` | opencode | `openrouter/deepseek/deepseek-v4-flash` | — |
| `@hades` | pi | `openrouter/deepseek/deepseek-v4-pro` | high |
| `@odin` | opencode | `openrouter/deepseek/deepseek-v4-pro` | — |
| `@helios` | pi | `openrouter/google/gemini-3.1-pro-preview` | high |
| `@heimdall` | opencode | `openrouter/google/gemini-3.1-pro-preview` | high |
| `@nike` | pi | `openrouter/google/gemini-3.7-flash` | low |
| `@sif` | opencode | `openrouter/google/gemini-3.7-flash` | low |
| `@prometheus` | pi | `openrouter/z-ai/glm-5.3` | high |
| `@hyperion` | codex | `gpt-5.6-sol` | ultra |
| `@phoebus` | codex | `gpt-5.6-sol` | xhigh |
| `@aether` | pi | `openai-codex/gpt-5.6-sol` | xhigh |
| `@sunna` | opencode | `openrouter/openai/gpt-5.6-sol` | xhigh |
| `@gaia` | codex | `gpt-5.6-terra` | xhigh |
| `@rhea` | pi | `openai-codex/gpt-5.6-terra` | xhigh |
| `@jord` | opencode | `openrouter/openai/gpt-5.6-terra` | xhigh |
| `@diana` | codex | `gpt-5.6-luna` | xhigh |
| `@phoebe` | pi | `openai-codex/gpt-5.6-luna` | xhigh |
| `@bil` | opencode | `openrouter/openai/gpt-5.6-luna` | xhigh |
| `@ares` | pi | `openrouter/x-ai/grok-4.6` | high |
| `@thor` | opencode | `openrouter/x-ai/grok-4.6` | — |
| `@endymion` | pi | `openrouter/moonshotai/kimi-k3` | xhigh |
| `@mani` | opencode | `openrouter/moonshotai/kimi-k3` | — |
| `@pan` | pi | `openrouter/meta-llama/llama-4-maverick` | high |
| `@vidar` | opencode | `openrouter/meta-llama/llama-4-maverick` | — |
| `@metis` | pi | `openrouter/minimax/minimax-m3` | high |
| `@mimir` | opencode | `openrouter/minimax/minimax-m3` | — |
| `@aeolus` | pi | `openrouter/mistralai/mistral-large-2512` | high |
| `@njord` | opencode | `openrouter/mistralai/mistral-large-2512` | — |
| `@hephaestus` | pi | `openrouter/qwen/qwen3.8-max` | high |
| `@tyr` | opencode | `openrouter/qwen/qwen3.8-max` | — |
| `@pygmalion` | image (Codex backend) | `gpt-image-2` | — |

Why some cells differ: `max` exists only on claude-code — pi's thinking scale and OpenRouter's effort scale both top out at `xhigh`, so that is the ceiling tier everywhere else. A `—` effort means the engine's catalog defines no effort variants for that model (it runs at the model's default reasoning).

Note on Fable 5: it is Anthropic's most capable model, priced above Opus, with turns that can run several minutes at high effort — reach for `@calliope`/`@clio` when the question really matters, not for routine gut-checks.


Add one, all, or a renamed copy:

```text
/consensflow:participants add zeus                    # add the zeus preset      → @zeus
/consensflow:participants add endymion                # Pi-backed Kimi K3 → @endymion
/consensflow:participants add all                     # add every preset at once
/consensflow:participants add zeus --name Deepreview  # same engine/model, your name → @deepreview
```

### Step 2 — Going custom (any other model)

The popular models already ship as presets (the tables above), so usually you just `add` a name. For anything else, define a **custom** participant — model/effort strings pass straight through, so **any identifier the engine accepts works.** One example per variation:

```text
# A different Claude model (claude-code effort: low | medium | high | xhigh | max)
/consensflow:participants add --name Sonnet --kind claude-code --model claude-sonnet-4-6 --effort high

# Any OpenRouter model via Pi (reasoning via --thinking off | minimal | low | medium | high | xhigh)
/consensflow:participants add --name PiGrok --kind pi --model openrouter/x-ai/grok-4.6 --thinking high

/consensflow:participants add --name Builder --kind opencode --model openrouter/moonshotai/kimi-k3 \
```


### Step 3 — Ask a participant

Two equivalent ways:

```text
@zeus What's the riskiest part of this design?                      # mention (anywhere in the line)
/consensflow:cf ask @zeus What's the riskiest part of this design?  # explicit router
```

A few real examples:

```text
@gaia Review the error handling in src/server.ts — blockers and test gaps only.
@aether What questions should I answer before I start building this?
@zeus Do you agree with Athena, or push back?     # he'll see Athena's earlier reply in the handoff
```

- Mention **one** participant. `@zeus @gaia …` is rejected on purpose.
- Participants don't get your git state automatically — when you want a diff reviewed, paste the relevant parts into the prompt (or have the Pi lead include them via the tool's `context` brief).
- A stray `@something` that isn't a participant (like `@types/node`) is ignored and just goes to your Pi lead.

### Step 4 — Read the answer (and where it's saved)

The reply appears inline in Pi. Every run is also saved under the ConsensFlow home — never inside your project:

```text
~/.consensflow/workspaces/<workspace>/runs/<run-id>/
  packet.md      # exactly what the participant was sent
  stdout.txt     # raw engine output
  stderr.txt     # raw engine errors/progress
  result.json    # parsed answer + metadata (incl. transcriptPath)
  transcript.md  # human-readable thinking / tool calls / answer — the durability backstop
```

**Watch it work live:** ConsensFlow streams the participant's thinking, tool calls, and answer into Pi as they arrive — direct `@name` / `/consensflow:cf` calls appear as lightweight messages in the main session, and lead-initiated `cf_run_participant` calls stream via `onUpdate`. This streaming is automatic and always on (no flag needed); the only exception is an explicit `--json` for machine-readable output. Always run participant calls in the FOREGROUND, NEVER in the background (or detached) — it's a hard property of the tool — so the live reasoning/tool/answer trail can stream as it arrives. Every text-CLI run also writes `transcript.md` into the run dir as a durability backstop; if a run ends without a final answer you get the bounded trail under a clear header, never a raw event dump. cf never caps a run — runs are unbounded.


Then you, the lead, decide: implement all of it, some of it, or none.

---

### The handoff — what a participant actually sees

Every run (unless skipped) embeds a **handoff**: a one-shot snapshot of your current session, built fresh at call time. Knowing what's in it tells you when to trust it and when to restate context yourself.

```text
Your live Pi session
   │  serialized at call time: "User: … / Lead: …" turns, tool calls noted,
   │  thinking redacted, earlier @participant replies kept near-whole
   ▼
capped at 48 KB by default (tunable via CONSENSFLOW_HANDOFF_MAX_BYTES) —
keeps the MOST RECENT tail, older history drops off behind a truncation marker
   ▼
embedded in the packet, between the mode line and your question
```

What that means in practice:

- **It's a rendering, not the raw context.** The participant gets readable conversation text, never your model's actual context window — so a 1M-token lead session can never overflow a 200k participant.
- **Short and medium sessions hand off essentially everything.** Only when the serialized text outgrows the 48 KB cap (tunable via `CONSENSFLOW_HANDOFF_MAX_BYTES`) does the oldest part fall away; a very long session hands off just the recent stretch.
- **You can see what rode along.** A clean run shows just the answer; a run with no session history warns `Handoff: empty`. `packet.md` in the run dir is byte-for-byte what the participant received.
- **Cross-pollination is deliberate.** Earlier participants' answers are kept near-whole in the handoff, so `@zeus Do you agree with Athena?` works. For a genuinely independent opinion, ask that participant first.
- **When old context matters, restate it.** If a decision from early in a long session is the point of your question, put it (or the relevant diff) in the prompt or the lead's `context` brief — don't assume it's still inside the tail.

### Images — the `@pygmalion` participant

`@pygmalion` is an **image** participant: mention it with a description and it generates a picture (gpt-image-2, via your existing `openai-codex` login — no extra key) instead of returning text.

```text
@pygmalion a minimalist logo for a terminal multi-agent tool — flat vector, navy + amber
```

The PNG is saved as `image.png` in the run dir and shown inline in Pi.

- Takes your **prompt only** — no session handoff (an image model can't use the transcript).
- Needs a ChatGPT Plus/Pro (Codex) login (`/login` → openai-codex); you get a clear error if it's missing.
- Roll your own: `/consensflow:participants add --name <name> --kind image` (the model field is only the trigger; the backend is always gpt-image-2).

## Where config and artifacts live

- **Participants (global, shared across tools):** `~/.consensflow/participants.json` — set up `@zeus` once and use him from any project *and* from the Claude Code sibling (consensflow-cc); both tools read the same roster. If this shared file is missing but an older per-tool roster exists at `~/.consensflow/consensflow-cc/participants.json` or `~/.consensflow/consensflow-pi/participants.json`, ConsensFlow migrates those entries into the shared file once.
- **Run artifacts (per workspace):** `~/.consensflow/workspaces/<workspace>-<hash>/runs/…` — stored in the home; nothing is ever created inside your project.

---

## Command reference

```text
/consensflow:cf [status|doctor|participants <…>|run @name <prompt>|ask @name <prompt>|@name <prompt>]
/consensflow:status
/consensflow:doctor
/consensflow:presets
/consensflow:participants [list|presets|add|show|remove|sync|add <…>]

@name <prompt>                   # ask — mention anywhere in the line
```

Preset add flags: `--name`, `--id`, `--cwd`, `--description`.
Custom add also accepts: `--kind`, `--model`, `--provider`, `--effort` / `--thinking`, `--tools`, `--skills`, `--agent`, `--maxTurns`.

---

## Good to know

- **One-shot:** participants don't remember previous calls. Continuity comes from the handoff (re-sent each time), which now includes earlier `@participant` answers — so a later participant sees an earlier one's reply. Great for debate; if you want a genuinely *independent* opinion, ask that participant **first**, before others have replied.
- **You're always the lead.** ConsensFlow routes your question and shows you the answer — it never implements or keeps anything on its own. The lead consults freely, but summarizes a participant's response (or any file edits it made) and asks before keeping or building on it, unless you've already told it to proceed.

---

## Develop / test

```bash
npm test     # node --test tests/*.test.mjs
```

---

<!-- ngvoicu author section — identical across all ngvoicu repos, keep in sync -->
## AI-native toolkit

This project is part of a larger AI-native toolkit — and of a way of working your whole team can adopt: talks (["Becoming an AI Native Company"](https://ngvoicu.dev/becoming-an-ai-native-company/)), hands-on team training that teaches employees to use AI, and [AI adoption consulting for engineering teams](https://ngvoicu.dev/#consulting).

- Site: [ngvoicu.dev](https://ngvoicu.dev)
- Contact: [office@ngvoicu.dev](mailto:office@ngvoicu.dev) · +40 734 704 910

Toolkit: [Specmint](https://specmint.ngvoicu.dev) (durable AI coding specs) · [Kluris](https://kluris.ngvoicu.dev) (team knowledge brains) · [ConsensFlow](https://consensflow.ngvoicu.dev) (cross-agent second opinions)
