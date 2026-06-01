# ConsensFlow Pi

Pi-native named-agent prompting for asking **one configured participant at a time**.

ConsensFlow is not a group chat, not a live shared transcript, and not a rigid workflow system. The current Pi session stays the lead. ConsensFlow lets you summon a participant — a preset like `@zeus`/`@athena` or a custom one you defined — with a natural-language prompt, hands it a snapshot of the current session, runs it in an isolated subprocess, saves the result as an artifact, and shows the answer back in Pi.

```text
@zeus What do you think about this approach?
@athena Review the latest changes and list blockers only.
@iris What questions should I answer before implementing this?
```

---

## Current direction

ConsensFlow Pi is now a lightweight **participant/subagent router**:

```text
Gabriel
  -> current Pi session as lead
  -> @participant natural-language prompt
  -> packet: identity + mode + session handoff + prompt (+ optional git diff)
  -> isolated participant subprocess (run with its configured tools)
  -> answer artifact, shown back in Pi
  -> Gabriel/Pi lead decides what to do next
```

Important rules:

- Send to exactly **one** participant at a time.
- No hidden fan-out. `@zeus @athena ...` is rejected.
- No hidden workflows. There are no special `review spec`, `implementation review`, `grill`, `council`, or `handoff` commands.
- Participants do not need to know ConsensFlow vocabulary. They answer the prompt as written.
- The current Pi session remains the lead and decides what, if anything, to implement.

---

## Source layout

The active implementation lives at the package root:

```text
consensflow-pi/
  extensions/consensflow.ts          # extension entry: commands, input routing, tools, packet/handoff wiring
  extensions/consensflow/lib/        # plain-JS logic (presets, state, packets, handoff, runners, workflows, utils)
  skills/consensflow/SKILL.md        # skill the Pi lead reads
  prompts/cf-ask.md                  # /cf-ask prompt template
  docs/                              # architecture.md, usage.md
  tests/core.test.mjs                # node --test suite
```

---

## Global config vs project artifacts

Participant config is **user-level/global**:

```text
~/.consensflow/participants.json
```

On this machine:

```text
/Users/gabrielvoicu/.consensflow/participants.json
```

Project-local `.consensflow/` is only for artifacts produced while working in that workspace:

```text
<workspace>/.consensflow/
  current.json
  runs/<run-id>/
    packet.md
    stdout.txt
    stderr.txt
    result.json
```

Usually add this to project `.gitignore`:

```text
.consensflow/
```

So you configure `@zeus` once globally, then use him from any project.

---

## How it works

### 1. Configure participants

ConsensFlow ships curated presets as convenient starting points, but you are not limited to them: rename a preset, or define a fully custom participant with any kind/model/effort/roles/tools.

Inspect presets:

```text
/cf participants presets
```

Current presets:

| Preset | Mention | Backend/model |
|---|---|---|
| `zeus` | `@zeus` | Claude Code Opus 4.7 MAX |
| `apollo` | `@apollo` | Claude Code Opus 4.7 XHIGH |
| `athena` | `@athena` | Codex GPT 5.5 XHIGH |
| `iris` | `@iris` | Pi GPT 5.5 XHIGH |
| `luna` | `@luna` | OpenCode Kimi K2.6 MAX |

Add from a preset, rename a preset, or define a custom participant:

```text
/cf participants add zeus                     # from a preset
/cf participants add zeus --name Deepreview   # preset backend, your own name (-> @deepreview, /deepreview)
/cf participants add all                      # every preset
/cf participants add --name Builder --kind codex --model gpt-5.5 --effort high \
    --roles implementer --tools workspace-write   # fully custom, write-capable
```

For a preset you may override `--name`, `--id`, `--cwd`, `--timeoutMs`, `--description` (backend/model/effort come from the preset). A custom participant accepts the full set: `--kind`, `--model`, `--effort`/`--thinking`, `--roles`, `--tools`, plus the operational fields. Each saved participant gets a dedicated `/<name>` command after `/reload`.

### 2. Talk to one participant directly

Each participant has its own command:

```text
/zeus What is the riskiest part of this design?
```

A bare mention or the generic router work too:

```text
@athena Review the latest changes and tell me only blockers.
/cf ask @iris What questions should I answer before implementation?
```

ConsensFlow intercepts the prompt whenever it names exactly one participant — the `@mention` can be anywhere, so `@zeus hi` and `hi @zeus` are equivalent — builds a scoped packet, runs the participant, and displays the answer. (A stray `@token` that isn't a configured participant, like `@types/node`, is left alone and goes to the Pi lead.)

**The Pi lead can also call a participant itself.** If you ask the lead in plain words — with no `@mention` — to consult someone (e.g. "get Zeus's take on this and apply what makes sense"), it uses its `cf_run_participant` tool to run the participant and fold the answer into its own work. So there are two distinct paths, never overlapping: a typed `@mention` always routes **directly** to that participant; with no mention, the **lead** decides whether to consult one. (This is single-participant orchestration, not fan-out — the lead still asks one at a time.)

### 3. ConsensFlow builds a scoped packet

Each run writes:

```text
.consensflow/runs/<run-id>/packet.md
```

The packet contains:

- who the participant is (name, kind, model, effort, roles)
- a mode line — read-only or read-write, from the participant's effective tools policy
- a handoff: a serialized, size-capped snapshot of the current session — your conversation with the Pi lead **and earlier `@participant` exchanges** (so asking Iris then Luna means Luna sees what Iris answered)
- Gabriel's prompt
- optional git status/diff context when your prompt mentions latest changes, diffs, patches, changed files, or implementation

The handoff is a one-shot snapshot built on demand from the session (oldest→newest, capped to keep the most recent tail), embedded in the packet — not a live or shared Pi transcript. There is no forced output format — the participant answers conversationally, like a normal coding session.

> Cross-pollination is intentional (you chose it): later participants build on earlier ones. If you want a deliberately *independent* second opinion, ask that participant first, before others have replied.

### 4. The participant runs as an isolated subagent

Each participant is internally treated like a subagent: isolated process, scoped prompt, explicit tools, no inherited conversation state.

Runner shapes:

| Kind | Runner shape | Notes |
|---|---|---|
| `pi` | `pi --mode json --no-session --no-extensions --thinking off -p` by default | Skills stay enabled by default. JSON mode gives cleaner final output/progress parsing. Configure `--thinking high/xhigh` when you want deeper reasoning.
| `claude-code` | `claude -p --output-format json --no-session-persistence` | Uses allowed tools. |
| `codex` | `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules` | Uses Codex sandbox mode and avoids user config/rules leaking hidden context. |
| `opencode` | `opencode run --format json --file packet.md` | File-attached packet. |

Pi participants deliberately use `--no-extensions` to avoid recursively loading ConsensFlow inside the child process. They do **not** use `--no-skills` by default, so installed Pi skills such as Kluris or Specmint can still be available when useful.

Pi skills policy is set by the preset. `@iris` keeps normal Pi skills enabled.

### 5. The answer becomes an artifact

Every run stores:

```text
.consensflow/runs/<run-id>/
  packet.md
  stdout.txt
  stderr.txt
  result.json
```

The current Pi lead then decides whether to implement all, some, or none of the participant's advice.

---

## Use cases

### Use case 1: simple second opinion

```text
@zeus What is the riskiest part of this plan?
```

Good for:

- quick architecture feedback
- naming/API opinions
- finding blind spots before coding

### Use case 2: ask for clarifying questions

There is no special "grill" command. Just ask for questions:

```text
@iris What questions should I answer before implementing this feature?
```

Good for:

- requirements discovery
- surfacing hidden product decisions
- tightening a vague task before coding

### Use case 3: review latest changes

```text
@athena Review the latest changes and list only blockers, test gaps, and risky assumptions.
```

Because the prompt says "latest changes", ConsensFlow includes git status/diff context when available.

Good for:

- pre-commit review
- sanity checking a local diff
- asking a stronger model to critique current work

### Use case 4: one-at-a-time disagreement

Do not ask multiple participants in one prompt. Ask one, read the answer, then ask another. Because of cross-pollination, the second participant already sees the first one's reply in its handoff — you don't have to relay it by hand:

```text
@zeus What do you think about using natural-language prompts instead of fixed workflow commands?
```

Then simply:

```text
@athena Do you agree with Zeus, or push back?
```

Athena's handoff already contains Zeus's answer. (If you'd rather Athena form an *independent* view, ask her first, before Zeus replies.)

Good for:

- controlled disagreement and debate
- avoiding noisy multi-agent fan-out
- letting Gabriel decide what to forward to the Pi lead

### Use case 5: reviewer-to-lead loop

```text
@zeus Review the latest changes. If you find issues, write them as concrete instructions for the lead implementer.
```

Then Gabriel can tell the current Pi lead:

```text
Implement Zeus's first and third suggestions. Ignore the second because it is out of scope.
```

Good for:

- using external agents as reviewers only
- keeping implementation control in the current Pi session
- selectively applying feedback

### Use case 6: scoped participant for a subdirectory

```text
/cf participants add athena --cwd gal-frontend
@athena Review the latest frontend changes and identify test gaps.
```

The `--cwd` must resolve inside the current workspace; escapes like `../other-project` are rejected before spawning.

Good for:

- large workspaces
- limiting context
- making named participants specialize by project area

---

## Commands

```text
/cf status
/cf doctor
/cf participants list
/cf participants presets
/cf participants add <preset> [--name <name>] [--cwd subdir] [--timeoutMs ms]
/cf participants add all
/cf participants add --name <name> --kind <pi|claude-code|codex|opencode> --model <model> [--effort <e>] [--thinking <t>] [--roles <r>] [--tools <readonly|workspace-write|full-auto>] [--cwd subdir]
/cf participants show @name
/cf participants remove @name

/<name> <natural-language prompt>        # dedicated per-participant command
@name <natural-language prompt>          # bare mention
/cf @name <natural-language prompt>      # generic router
/cf ask @name <natural-language prompt>
```

Add options — preset path: `--name`, `--id`, `--cwd`, `--timeoutMs`, `--description`. Custom path also accepts `--kind`, `--model`, `--provider`, `--effort`/`--thinking`, `--roles`, `--tools`, `--sessionPolicy`, `--contextPolicy`, `--skills`, `--agent`, `--maxTurns`.

Examples:

```text
/cf participants add all
/cf participants add zeus
/cf participants add zeus --name Deepreview
/cf participants add athena --cwd gal-frontend
/cf participants add --name Builder --kind codex --model gpt-5.5 --roles implementer --tools workspace-write
```

---

## Safety model

- Participants run with their configured tools policy. A `workspace-write`/`full-auto` participant can edit files and run commands like your main agent.
- Participants whose roles are purely advisory (`reviewer`/`council`/`knowledge`) are always coerced to read-only — even if a write policy was set. Advisory roles never receive write flags. To get a write-capable participant, give it a non-advisory role (e.g. `--roles implementer`).
- Multiple participant mentions are rejected to avoid hidden serial/parallel execution.
- Participant `--cwd` must stay inside the workspace (validated before spawning).
- Each call is one-shot: child Pi participants use `--no-session` (no persistent Pi conversations) and `--no-extensions` (no recursive ConsensFlow load).
- The session handoff embedded in the packet is size-capped; participants get a one-shot snapshot, not a live/shared transcript.
- Pi skills policy is preset-controlled; `@iris` keeps Pi skills enabled by default.

---

## Install for local development

```bash
cd /Users/gabrielvoicu/Projects/ngvoicu/consensflow/consensflow-pi
pi install . -l
```

Temporary load without installing:

```bash
cd /Users/gabrielvoicu/Projects/ngvoicu/consensflow/consensflow-pi
pi --no-extensions -e .
```

---

## Tests

```bash
cd /Users/gabrielvoicu/Projects/ngvoicu/consensflow/consensflow-pi
npm test
```

---

## Current limitations

- One participant per prompt.
- No automatic fan-out or council orchestration.
- No hidden spec/review/grill/handoff workflows.
- Participants are one-shot — they keep no memory between calls. (Continuity comes only from the session handoff re-sent each call, which now includes earlier participant exchanges; the participant process itself does not persist.)
- The current Pi lead remains responsible for implementation and final judgment.
