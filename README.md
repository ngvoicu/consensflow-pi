# ConsensFlow Pi

Ask other AI coding agents — **Claude Code, Codex, Pi, OpenCode** — for a second opinion, **one at a time, by name**, without leaving your Pi session.

---

## What is it? (the 30-second version)

You're coding with **Pi**, your main AI assistant. Sometimes you want another model's take — maybe Claude is sharper on architecture, you want Codex to sanity-check a diff, or a cheap fast model for a quick gut-check.

ConsensFlow lets you keep a roster of **participants**. A participant is just *one specific AI agent + model* that you've set up and given a name — like `@zeus` or `@athena`. When you want one's opinion, you `@mention` it right in your Pi chat. ConsensFlow then:

1. packages a snapshot of your current conversation (the **handoff**) plus your question,
2. runs that agent in an isolated subprocess as a **one-shot** (your session stays usable),
3. and shows you its answer.

Think of it as a panel of advisors on speed-dial. **You stay in charge** (you're "the lead") — they advise, and you decide what to keep. It is **not** a group chat, not parallel fan-out, not a fixed workflow. One question → one participant → one answer, every time.

The whole idea in five bullets:

- **Participant** = a named *(agent + model)* combo. Configure once, reuse from any project.
- **One at a time.** `@zeus @athena …` is rejected — ask one, read, then ask the next.
- **Read-only by default.** A participant can look at your files but not change them, unless you explicitly make it write-capable.
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
   • who @zeus is        (claude-code · claude-opus-4-8 · max)
   • mode line           (read-only — or read-write if you made it write-capable)
   • handoff             (a snapshot of THIS session + earlier @participant replies)
   • your question
   ▼
Runs @zeus as an isolated, one-shot subprocess:
   claude -p … --model claude-opus-4-8 --effort max   (read-only tools)
   no memory of past calls, no live access to your session — just the packet
   ▼
Saves everything as an artifact:
   ~/.consensflow/consensflow-pi/workspaces/<workspace>/runs/<run-id>/{packet.md, stdout.txt, stderr.txt, result.json}
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
/cf doctor      # shows which engine CLIs are installed and working
/cf status      # shows your configured participants
```

**Uninstall** any time with `pi remove <source>` (the same URL or path you installed) — your participant config is left untouched.

---

## How to use

### Step 1 — Configure a participant

Two ways: start from a **preset** (curated, known-good combos) or define a **custom** one (any engine + any model).

See the presets:

```text
/cf participants presets
```

All presets in one view. The same model+effort family appears on **every tool that runs it**, so you can compare how different harnesses drive the same model. Effort means `--effort` on claude-code/codex, the `--thinking` level on pi, and the `--variant` on opencode.

Sorted by model, then effort (strongest first). Claude Fable 5, Claude Opus 4.8, and GPT 5.5 lead; the rest are alphabetical.

| Preset | Tool | Model | Effort | Mode |
|---|---|---|---|---|
| `@calliope` | claude-code | `claude-fable-5` | max | read-only |
| `@clio` | claude-code | `claude-fable-5` | xhigh | read-only |
| `@orpheus` | pi | `anthropic/claude-fable-5` | xhigh | read-only |
| `@saga` | opencode | `openrouter/anthropic/claude-fable-5` | xhigh | read-only |
| `@euterpe` | claude-code | `claude-fable-5` | high | read-only |
| `@linus` | pi | `anthropic/claude-fable-5` | high | read-only |
| `@gunnlod` | opencode | `openrouter/anthropic/claude-fable-5` | high | read-only |
| `@thalia` | claude-code | `claude-fable-5` | medium | read-only |
| `@erato` | pi | `anthropic/claude-fable-5` | medium | read-only |
| `@kvasir` | opencode | `openrouter/anthropic/claude-fable-5` | medium | read-only |
| `@zeus` | claude-code | `claude-opus-4-8` | max | read-only |
| `@apollo` | claude-code | `claude-opus-4-8` | xhigh | read-only |
| `@kronos` | pi | `anthropic/claude-opus-4-8` | xhigh | read-only |
| `@baldr` | opencode | `openrouter/anthropic/claude-opus-4.8` | xhigh | read-only |
| `@artemis` | claude-code | `claude-opus-4-8` | medium | read-only |
| `@atlas` | pi | `anthropic/claude-opus-4-8` | medium | read-only |
| `@vali` | opencode | `openrouter/anthropic/claude-opus-4.8` | medium | read-only |
| `@athena` | codex | `gpt-5.5` | xhigh | read-only |
| `@iris` | pi | `openai-codex/gpt-5.5` | xhigh | read-only |
| `@forseti` | opencode | `openrouter/openai/gpt-5.5` | xhigh | read-only |
| `@perseus` | codex | `gpt-5.5` | high | read-only |
| `@hermes` | pi | `openai-codex/gpt-5.5` | high | read-only |
| `@bragi` | opencode | `openrouter/openai/gpt-5.5` | high | read-only |
| `@loki` | codex | `gpt-5.5` | medium | read-only |
| `@eos` | pi | `openai-codex/gpt-5.5` | medium | read-only |
| `@ullr` | opencode | `openrouter/openai/gpt-5.5` | medium | read-only |
| `@hermod` | claude-code | `claude-haiku-4-5` | low | read-only |
| `@zephyros` | pi | `openrouter/deepseek/deepseek-v4-flash` | low | read-only |
| `@freya` | opencode | `openrouter/deepseek/deepseek-v4-flash` | — | read-only |
| `@hades` | pi | `openrouter/deepseek/deepseek-v4-pro` | high | read-only |
| `@odin` | opencode | `openrouter/deepseek/deepseek-v4-pro` | — | read-only |
| `@helios` | pi | `openrouter/google/gemini-3.1-pro-preview` | high | read-only |
| `@heimdall` | opencode | `openrouter/google/gemini-3.1-pro-preview` | high | read-only |
| `@nike` | pi | `openrouter/google/gemini-3.5-flash` | low | read-only |
| `@sif` | opencode | `openrouter/google/gemini-3.5-flash` | low | read-only |
| `@ares` | pi | `openrouter/x-ai/grok-4.3` | high | read-only |
| `@thor` | opencode | `openrouter/x-ai/grok-4.3` | — | read-only |
| `@luna` | opencode | `openrouter/moonshotai/kimi-k2.6` | — | read-only |
| `@pan` | pi | `openrouter/meta-llama/llama-4-maverick` | high | read-only |
| `@vidar` | opencode | `openrouter/meta-llama/llama-4-maverick` | — | read-only |
| `@metis` | pi | `openrouter/minimax/minimax-m3` | high | read-only |
| `@mimir` | opencode | `openrouter/minimax/minimax-m3` | — | read-only |
| `@aeolus` | pi | `openrouter/mistralai/mistral-large-2512` | high | read-only |
| `@njord` | opencode | `openrouter/mistralai/mistral-large-2512` | — | read-only |
| `@hephaestus` | pi | `openrouter/qwen/qwen3.7-max` | high | read-only |
| `@tyr` | opencode | `openrouter/qwen/qwen3.7-max` | — | read-only |
| `@pygmalion` | image (Codex backend) | `gpt-image-2` | — | — |

Why some cells differ: `max` exists only on claude-code — pi's thinking scale and OpenRouter's effort scale both top out at `xhigh`, so that is the ceiling tier everywhere else. A `—` effort means the engine's catalog defines no effort variants for that model (it runs at the model's default reasoning).

Note on Fable 5: it is Anthropic's most capable model, priced above Opus, with turns that can run several minutes at high effort — reach for `@calliope`/`@clio` when the question really matters, not for routine gut-checks.

Auth, per row: Claude models on claude-code ride your Claude login; `gpt-5.5` on codex/pi rides your ChatGPT (Codex) login; `anthropic/...` on pi needs Anthropic auth set up in pi; every `openrouter/...` model needs an OpenRouter key in that engine. All presets are read-only — for a write-capable participant, create a custom one (Step 2).

Add one, all, or a renamed copy:

```text
/cf participants add zeus                    # add the zeus preset      → @zeus, /zeus
/cf participants add all                     # add every preset at once
/cf participants add zeus --name Deepreview  # same engine/model, your name → @deepreview
```

After adding, run `/reload` so each participant gets its own `/<name>` command. (The `@name` form works immediately, no reload needed.)

### Step 2 — Going custom (any other model)

The popular models already ship as presets (the tables above), so usually you just `add` a name. For anything else, define a **custom** participant — model/effort strings pass straight through, so **any identifier the engine accepts works.** One example per variation:

```text
# A different Claude model (claude-code effort: low | medium | high | xhigh | max)
/cf participants add --name Sonnet --kind claude-code --model claude-sonnet-4-6 --effort high

# Any OpenRouter model via Pi (reasoning via --thinking off | minimal | low | medium | high | xhigh)
/cf participants add --name PiGPT --kind pi --model openrouter/openai/gpt-5.5 --thinking high

# A write-capable participant, not just a reviewer (OpenCode; effort maps to --variant)
/cf participants add --name Builder --kind opencode --model openrouter/moonshotai/kimi-k2.6 \
    --effort max --tools workspace-write
```

> **Read-only vs write.** By default a participant can only read. To let one actually edit files and run commands, pass `--tools workspace-write` (or `full-auto`) — write access is never implicit.

### Step 3 — Ask a participant

Three equivalent ways:

```text
@zeus What's the riskiest part of this design?            # mention (anywhere in the line)
/zeus What's the riskiest part of this design?            # dedicated command (after /reload)
/cf ask @zeus What's the riskiest part of this design?    # generic router
```

A few real examples:

```text
@athena Review the error handling in src/server.ts — blockers and test gaps only.
@iris What questions should I answer before I start building this?
@zeus Do you agree with Athena, or push back?     # he'll see Athena's earlier reply in the handoff
```

- Mention **one** participant. `@zeus @athena …` is rejected on purpose.
- Participants don't get your git state automatically — when you want a diff reviewed, paste the relevant parts into the prompt (or have the Pi lead include them via the tool's `context` brief).
- A stray `@something` that isn't a participant (like `@types/node`) is ignored and just goes to your Pi lead.

### Step 4 — Read the answer (and where it's saved)

The reply appears inline in Pi. Every run is also saved under the ConsensFlow home — never inside your project:

```text
~/.consensflow/consensflow-pi/workspaces/<workspace>/runs/<run-id>/
  packet.md      # exactly what the participant was sent
  stdout.txt     # raw engine output
  stderr.txt     # raw engine errors/progress
  result.json    # parsed answer + metadata
```

After a write-capable run, review what changed yourself (e.g. `git status` / `git diff` in your repo) before keeping it.

Then you, the lead, decide: implement all of it, some of it, or none.

---

### The handoff — what a participant actually sees

Every run (unless skipped) embeds a **handoff**: a one-shot snapshot of your current session, built fresh at call time. Knowing what's in it tells you when to trust it and when to restate context yourself.

```text
Your live Pi session
   │  serialized at call time: "User: … / Lead: …" turns, tool calls noted,
   │  thinking redacted, earlier @participant replies kept near-whole
   ▼
capped at 120 KB (~30k tokens) — keeps the MOST RECENT tail,
older history drops off behind a truncation marker
   ▼
embedded in the packet, between the mode line and your question
```

What that means in practice:

- **It's a rendering, not the raw context.** The participant gets readable conversation text, never your model's actual context window — so a 1M-token lead session can never overflow a 200k participant.
- **Short and medium sessions hand off essentially everything.** Only when the serialized text outgrows 120 KB does the oldest part fall away; a very long session hands off just the recent stretch.
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
- Roll your own: `/cf participants add --name <name> --kind image` (the model field is only the trigger; the backend is always gpt-image-2).

## Where config and artifacts live

- **Participants (global, per tool):** `~/.consensflow/consensflow-pi/participants.json` — set up `@zeus` once, use him from any project. The Claude Code sibling (consensflow-cc) keeps its own same-format roster under `~/.consensflow/consensflow-cc/`; copy entries between the two files to share them.
- **Run artifacts (per workspace):** `~/.consensflow/consensflow-pi/workspaces/<workspace>-<hash>/runs/…` — stored in the home; nothing is ever created inside your project.

---

## Command reference

```text
/cf status                       # your participants + latest run
/cf doctor                       # which engine CLIs are installed
/cf participants presets         # list the built-in presets
/cf participants list            # list configured participants
/cf participants add <preset> [--name N] [--cwd subdir] [--timeoutMs ms]
/cf participants add all
/cf participants add --name N --kind <pi|claude-code|codex|opencode|image> --model M \
     [--effort e | --thinking t] [--tools readonly|workspace-write|full-auto] [--cwd subdir]
/cf participants show @name
/cf participants remove @name

@name <prompt>                   # ask — mention anywhere in the line
/name <prompt>                   # dedicated command (after /reload)
/cf @name <prompt>               # generic router
/cf ask @name <prompt>
```

Preset add flags: `--name`, `--id`, `--cwd`, `--timeoutMs`, `--description`.
Custom add also accepts: `--kind`, `--model`, `--provider`, `--effort` / `--thinking`, `--tools`, `--skills`, `--agent`, `--maxTurns`.

---

## Good to know

- **One-shot:** participants don't remember previous calls. Continuity comes from the handoff (re-sent each time), which now includes earlier `@participant` answers — so a later participant sees an earlier one's reply. Great for debate; if you want a genuinely *independent* opinion, ask that participant **first**, before others have replied.
- **Isolated & safe:** each participant runs in its own one-shot subprocess, started in your workspace; a `--cwd` that escapes it is rejected before launch (realpath-checked). Isolation comes from each engine's tool policy — a true OS sandbox only for Codex — so treat read-only as policy enforcement, not a hard sandbox. Pi participants run with `--no-extensions` so ConsensFlow can't recurse into itself. Read-only is enforced with each engine's own mechanism: an OS sandbox for Codex, allow+deny tool lists for Claude Code, a read-only tool allowlist for Pi, and a deny-edit/bash permission override (`OPENCODE_PERMISSION`) for OpenCode.
- **You're always the lead.** ConsensFlow routes your question and shows you the answer — it never implements or keeps anything on its own. The lead consults freely, but summarizes a participant's response (or a write-capable participant's file edits) and asks before applying it, unless you've already told it to proceed.

---

## Develop / test

```bash
npm test     # node --test tests/*.test.mjs
```
