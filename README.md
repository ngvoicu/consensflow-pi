# ConsensFlow Pi

Ask other AI coding agents — **Claude Code, Codex, Pi, OpenCode** — for a second opinion, **one at a time, by name**, without leaving your Pi session.

---

## What is it? (the 30-second version)

You're coding with **Pi**, your main AI assistant. Sometimes you want another model's take — maybe Claude is sharper on architecture, you want Codex to sanity-check a diff, or a cheap fast model for a quick gut-check.

ConsensFlow lets you keep a roster of **participants**. A participant is just *one specific AI agent + model* that you've set up and given a name — like `@zeus` or `@athena`. When you want one's opinion, you `@mention` it right in your Pi chat. ConsensFlow then:

1. packages a snapshot of your current conversation (the **handoff**) plus your question,
2. runs that agent quietly in the background as a **one-shot**,
3. and shows you its answer.

Think of it as a panel of advisors on speed-dial. **You stay in charge** (you're "the lead") — they only give input. It is **not** a group chat, not parallel fan-out, not a fixed workflow. One question → one participant → one answer, every time.

The whole idea in five bullets:

- **Participant** = a named *(agent + model)* combo. Configure once, reuse from any project.
- **One at a time.** `@zeus @athena …` is rejected — ask one, read, then ask the next.
- **Read-only by default.** A participant can look at your files but not change them, unless you explicitly make it write-capable.
- **One-shot, but context-aware.** Each call is fresh (no memory of past calls), yet it always receives the current session handoff — *including earlier participants' answers* — so the 2nd agent you ask can build on the 1st.
- **The lead can ask too.** You can also just tell Pi "get Zeus's take and apply what makes sense," and Pi will call the participant itself.

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
   • who @zeus is        (claude-code · claude-opus-4-8 · max · reviewer)
   • mode line           (read-only — or read-write if you made it write-capable)
   • handoff             (a snapshot of THIS session + earlier @participant replies)
   • your question
   • git status/diff      (only if your prompt mentions "latest changes")
   ▼
Runs @zeus as an isolated, one-shot subprocess:
   claude -p … --model claude-opus-4-8 --effort max   (read-only tools)
   no memory of past calls, no live access to your session — just the packet
   ▼
Saves everything as an artifact:
   <workspace>/.consensflow/runs/<run-id>/{packet.md, stdout.txt, result.json}
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

**Install the extension** (from this folder):

```bash
cd /path/to/consensflow-pi
pi install .
```

This registers it in your user-level Pi settings, so it's available in every Pi session. Start a new session (or restart Pi) to load it.

**Verify**

```text
/cf doctor      # shows which engine CLIs are installed and working
/cf status      # shows your configured participants
```

**Uninstall** any time with `pi remove .` — your source folder and your participant config are left untouched.

---

## How to use

### Step 1 — Configure a participant

Two ways: start from a **preset** (curated, known-good combos) or define a **custom** one (any engine + any model).

See the presets:

```text
/cf participants presets
```

**House team — one strong read-only reviewer per engine:**

| Preset | Engine | Model | Effort |
|---|---|---|---|
| `@zeus`   | claude-code | `claude-opus-4-8` | max |
| `@apollo` | claude-code | `claude-opus-4-8` | xhigh |
| `@athena` | codex | `gpt-5.5` | xhigh |
| `@iris`   | pi | `openai-codex/gpt-5.5` | thinking xhigh |
| `@luna`   | opencode | `openrouter/moonshotai/kimi-k2.6` | max |

**Fast/cheap tier — quick gut-checks:**

| Preset | Engine | Model |
|---|---|---|
| `@hermod` | claude-code | `claude-haiku-4-5` (low) |
| `@loki`   | codex | `gpt-5.5` (medium) |
| `@nike`   | pi | `openrouter/google/gemini-3.5-flash` |
| `@freya`  | opencode | `openrouter/deepseek/deepseek-v4-flash` |

**Model zoo — the same popular OpenRouter models on both engines (Greek names = pi, Norse names = opencode):**

| Model | via pi | via opencode |
|---|---|---|
| DeepSeek V4 Pro | `@hades` | `@odin` |
| Gemini 3.1 Pro | `@helios` | `@heimdall` |
| Grok 4.3 | `@ares` | `@thor` |
| Qwen3.7 Max | `@hephaestus` | `@tyr` |
| Llama 4 Maverick | `@pan` | `@vidar` |
| Mistral Large | `@aeolus` | `@njord` |
| MiniMax M3 | `@metis` | `@mimir` |

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
# A different Claude model (claude-code effort: low | medium | high | max)
/cf participants add --name Sonnet --kind claude-code --model claude-sonnet-4-6 --effort high

# Any OpenRouter model via Pi (reasoning via --thinking off | low | high | xhigh)
/cf participants add --name PiGPT --kind pi --model openrouter/openai/gpt-5.5 --thinking high

# A write-capable implementer, not just a reviewer (OpenCode; effort maps to --variant)
/cf participants add --name Builder --kind opencode --model openrouter/moonshotai/kimi-k2.6 \
    --effort max --roles implementer --tools workspace-write
```

> **Read-only vs write.** By default a participant is a **reviewer** and can only read. To let one actually edit files and run commands, give it a non-advisory role and a write policy: `--roles implementer --tools workspace-write` (or `full-auto`). Advisory roles (`reviewer` / `council` / `knowledge`) are *always* forced read-only, even if you pass a write flag.

### Step 3 — Ask a participant

Three equivalent ways:

```text
@zeus What's the riskiest part of this design?            # mention (anywhere in the line)
/zeus What's the riskiest part of this design?            # dedicated command (after /reload)
/cf ask @zeus What's the riskiest part of this design?    # generic router
```

A few real examples:

```text
@athena Review the latest changes and list only blockers and test gaps.
@iris What questions should I answer before I start building this?
@zeus Do you agree with Athena, or push back?     # he'll see Athena's earlier reply in the handoff
```

- Mention **one** participant. `@zeus @athena …` is rejected on purpose.
- Say **"latest changes"** (or diff / patch / changed files) and ConsensFlow attaches your `git status` + diff for context.
- A stray `@something` that isn't a participant (like `@types/node`) is ignored and just goes to your Pi lead.

### Step 4 — Read the answer (and where it's saved)

The reply appears inline in Pi. Every run is also saved under the workspace:

```text
<workspace>/.consensflow/runs/<run-id>/
  packet.md      # exactly what the participant was sent
  stdout.txt     # raw engine output
  result.json    # parsed answer + metadata
```

Then you, the lead, decide: implement all of it, some of it, or none.

---

## Where config and artifacts live

- **Participants (global):** `~/.consensflow/participants.json` — set up `@zeus` once, use him from any project.
- **Run artifacts (per project):** `<workspace>/.consensflow/runs/…` — already in `.gitignore` here.

---

## Command reference

```text
/cf status                       # your participants + latest run
/cf doctor                       # which engine CLIs are installed
/cf participants presets         # list the built-in presets
/cf participants list            # list configured participants
/cf participants add <preset> [--name N] [--cwd subdir] [--timeoutMs ms]
/cf participants add all
/cf participants add --name N --kind <pi|claude-code|codex|opencode> --model M \
     [--effort e | --thinking t] [--roles r] [--tools readonly|workspace-write|full-auto] [--cwd subdir]
/cf participants show @name
/cf participants remove @name

@name <prompt>                   # ask — mention anywhere in the line
/name <prompt>                   # dedicated command (after /reload)
/cf @name <prompt>               # generic router
/cf ask @name <prompt>
```

Preset add flags: `--name`, `--id`, `--cwd`, `--timeoutMs`, `--description`.
Custom add also accepts: `--kind`, `--model`, `--provider`, `--effort` / `--thinking`, `--roles`, `--tools`, `--skills`, `--agent`, `--maxTurns`.

---

## Good to know

- **One-shot:** participants don't remember previous calls. Continuity comes from the handoff (re-sent each time), which now includes earlier `@participant` answers — so a later participant sees an earlier one's reply. Great for debate; if you want a genuinely *independent* opinion, ask that participant **first**, before others have replied.
- **Isolated & safe:** each participant runs in its own subprocess, scoped to your workspace. A `--cwd` that escapes the workspace is rejected before launch. Pi participants run with `--no-extensions` so ConsensFlow can't recurse into itself.
- **You're always the lead.** ConsensFlow never implements anything on its own — it routes a question and shows you an answer.

---

## Develop / test

```bash
npm test     # node --test tests/*.test.mjs
```
