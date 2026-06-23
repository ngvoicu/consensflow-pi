---
name: consensflow
description: Use ConsensFlow inside Pi to consult one named participant (an external coding-agent CLI, run one-shot) for second opinions, design/code critique, questions, implementation help, or write-capable task execution. Activate whenever the user asks a named agent for input OR whenever the lead itself should reach for an advisor/helper. Consulting is free and encouraged; acting on a participant's response or keeping its file changes is gated behind explicit user approval unless the user already authorized it.
---

# ConsensFlow

ConsensFlow lets the lead (this Pi session) consult one named participant at a time. A participant is an external coding-agent CLI (claude / codex / opencode / pi) run as an isolated one-shot subprocess: it receives a handoff of the current session plus a prompt, answers once, and does not persist between calls. Talking to a participant is like phoning an advisor/helper — and, when explicitly made write-capable, briefly handing over a task. The lead stays the decision-maker and ConsensFlow never accepts or keeps participant work on its own.

## What participants can do

Use participants for all of these, one participant at a time. No preset is intrinsically review-only; the same participant can advise in safe mode or do workspace work when made write-capable:

- **Advice / second opinion / design critique.** Ask a participant to inspect context, critique a plan, assess a pasted diff, identify risks, or suggest tests.
- **Doing work / code-writing help.** The same participant can implement, refactor, or run commands when it is write-capable (stored `--tools workspace-write` / `full-auto`, or a per-call `toolsPolicy` override in `cf_run_participant`). Treat it like a temporary helper: after the run, inspect `git status` / `git diff` and relevant tests, then ask the user before keeping or building on the changes unless they pre-authorized it.
- **Image generation.** `@pygmalion` (or any `kind=image` participant) uses **gpt-image-2** via Pi's `openai-codex` login. It receives the image prompt only — no session handoff — saves `image.png` in the ConsensFlow run dir under `~/.consensflow/workspaces/…`, and Pi shows the generated image inline. Optionally pass one or more **reference images** with `--image <path>` (repeatable, or the `cf_run_participant` tool's `images` param) so gpt-image-2 edits/conditions on them — supply a file path (.png/.jpg/.jpeg/.webp/.gif).

## The two rules that matter most

These two rules are the heart of the skill. They pull in opposite directions on purpose: consulting is cheap and encouraged; acting on the result is gated.

### 1. Consulting is free — and encouraged

The lead may, and should, reach for a participant on its own initiative, with NO user permission needed merely to consult. Treat a participant consultation as a natural reflex, not a rare ceremony — before finalizing a non-trivial design or diff, consider getting another take. Just call `cf_run_participant`; you do not ask the user "may I consult X?" first. Good moments, with the kind of prompt to send:

- **Before finalizing a non-trivial design or diff** — `@zeus` "Review this approach; call out the riskiest assumption and anything you'd do differently."
- **To stress-test a plan** — `@athena` "Poke holes in this migration plan — what breaks under load or on rollback?"
- **To surface unknowns before building** — `@iris` "What questions should I answer before I start implementing this?"
- **For a quick gut-check or tie-breaker** — `@luna` "Does this error handling read as correct to you — yes/no with one reason?"
- **For a focused diff/task check** — run `git diff` yourself and paste the relevant parts into the prompt or `context` brief.

### 2. Acting on the output is GATED — never without asking

The lead MUST NOT apply, merge, commit, adopt, integrate, or otherwise act on a participant's response — and MUST NOT keep or extend any files a write-capable participant edited — without first surfacing it to the user and getting explicit approval. This is a hard rule, not a preference.

Before acting, the lead MUST present:

- a concise **summary** of what the participant said or did, and
- the **lead's own recommendation** (accept / accept-with-changes / reject, and why).

Then wait for the user to approve.

This gate covers BOTH cases equally:

- **(a) Advice in a text response.** Do not implement, refactor toward, or commit to a participant's suggestion until the user approves it.
- **(b) Real changes by a write-capable participant.** A `workspace-write` / `full-auto` participant may have edited files or run commands in the workspace. Do not treat that work as accepted: surface what changed (summary + recommendation) and get approval before keeping, building on, or committing it. If the user rejects it, revert it.

**The only exception:** the user has already explicitly told the lead to proceed — e.g. "get Zeus's take and apply what makes sense," or "run the builder and commit it." Pre-authorization scoped to that request stands in for the approval; do not re-ask. Absent such an instruction, never act on a participant's output on your own.

Do / Never, in one line each:

- **Do** consult a participant whenever a second opinion would help — no permission needed.
- **Never** apply, commit, or keep a participant's advice or file changes without the user's go-ahead, unless the user pre-authorized it.

In short: ask freely, apply only with a green light.

## How participants are created

Participants are configured in the shared roster `~/.consensflow/participants.json` (set up once, use from any project, Pi, and the Claude Code sibling). There are no per-tool config roots. Participants come from curated presets or fully custom definitions:

```text
/consensflow:presets                            # list built-in presets
/consensflow:participants add zeus              # add a preset            → @zeus
/consensflow:participants add daedalus          # Pi-backed Kimi K2.7 Code → @daedalus
/consensflow:participants add all               # add every preset
/consensflow:participants add zeus --name Deepreview    # preset backend, renamed → @deepreview
/consensflow:participants add --name Builder --kind codex --model gpt-5.5 --effort high \
    --tools workspace-write                     # fully custom, write-capable by default
```

Presets use default safe mode; the same model+effort family exists on every engine that runs it:

- **Fable 5** (Anthropic's top model — use for the questions that really matter): `@calliope`/`@clio`/`@euterpe`/`@thalia` (Claude Code max/xhigh/high/medium), `@orpheus`/`@linus`/`@erato` (Pi xhigh/high/medium, Anthropic auth), `@saga`/`@gunnlod`/`@kvasir` (OpenCode xhigh/high/medium via OpenRouter).
- **Opus 4.8**: `@zeus`/`@apollo`/`@artemis` (Claude Code max/xhigh/medium), `@kronos`/`@atlas` (Pi xhigh/medium, Anthropic auth), `@baldr`/`@vali` (OpenCode xhigh/medium via OpenRouter; xhigh is the ceiling outside claude-code).
- **GPT 5.5**: `@athena`/`@perseus`/`@loki` (Codex xhigh/high/medium), `@iris`/`@hermes`/`@eos` (Pi xhigh/high/medium), `@forseti`/`@bragi`/`@ullr` (OpenCode xhigh/high/medium via OpenRouter).
- **Deep open-weights**: Kimi K2.7 Code — `@luna` (OpenCode), `@daedalus` (Pi craftsman preset), `@selene` (Pi moon-goddess alias; both Pi presets use high thinking).
- **Fast/cheap tier** (quick gut-checks): `@hermod` (Claude Haiku 4.5), `@nike`/`@sif` (Gemini 3.5 Flash on Pi/OpenCode), `@zephyros`/`@freya` (DeepSeek V4 Flash on Pi/OpenCode).
- **Model zoo** (same OpenRouter models on two engines; Greek = pi, Norse = opencode): DeepSeek V4 Pro `@hades`/`@odin`, Gemini 3.1 Pro `@helios`/`@heimdall`, Grok 4.3 `@ares`/`@thor`, Qwen3.7 Max `@hephaestus`/`@tyr`, Llama 4 Maverick `@pan`/`@vidar`, Mistral Large `@aeolus`/`@njord`, MiniMax M3 `@metis`/`@mimir`, GLM 5.2 `@prometheus` (pi only).
- **Image**: `@pygmalion` (kind=image) generates a picture with gpt-image-2 via your existing openai-codex login — prompt-only (no handoff), optional `--image <path>` reference(s), saved to the workspace's run dir under `~/.consensflow/workspaces/…` and shown inline.

Run `/consensflow:presets` for the full list. Model and effort strings pass through to the engine verbatim, so any identifier the engine accepts works.

## How to ask

Use `@name` anywhere in the line, or the explicit `/consensflow:cf` router:

```text
@zeus What's the riskiest part of this design?                  # mention, anywhere in the line
/consensflow:cf @zeus What's the riskiest part of this design?  # explicit router
```

Pi intentionally matches Claude Code's slash-command surface: only `/consensflow:*` slash commands are registered; no unnamespaced shortcuts or per-participant slash commands. A stray `@token` that is not a participant is ignored and goes to the lead as normal text.

From the lead, **prefer the `cf_run_participant` tool.** Pass an optional `context` brief on top of the auto-included session handoff to focus the participant on exactly what you want assessed or done.

## Full command reference

Pi exposes the same ConsensFlow slash commands as Claude Code:

```text
/consensflow:cf [status|doctor|participants <…>|run @name <prompt>|ask @name <prompt>|@name <prompt>]
/consensflow:status
/consensflow:doctor
/consensflow:presets
/consensflow:participants [list|presets|add|show|remove|add <…>]

@name <prompt>                                            # ask — mention anywhere in the line
/consensflow:cf @name <prompt> [--rw|--tools workspace-write|full-auto]  # explicit router, optional per-call write
```

## Tools available to the lead

- `cf_list_participants` — see who is configured.
- `cf_run_participant` — send one prompt to one participant. This is the preferred path when the lead consults on its own initiative.

`cf_run_participant` parameters the lead should know:

- `participant` — `@name` or `name`.
- `prompt` — the exact question/task for that participant.
- `context` — optional focused brief added on top of the automatic session handoff.
- `includeHandoff` — defaults to true; set false only when the participant should not see the current session snapshot.
- `timeoutMs` — optional timeout override.
- `toolsPolicy` — optional per-call write override: `workspace-write` or `full-auto`. Omit it for default safe mode (no write tools).

## Safe-mode vs write-capable participants

- **Default and presets:** safe mode (no write tools). They are not review-only; they can plan, critique, explain, and propose code, but they cannot edit files or run commands until made write-capable.
- **Stored write-capable participant:** create/update with `--tools workspace-write` (or `full-auto`) when the participant is meant to edit by default.
- **Per-call write access from the lead:** pass `toolsPolicy: "workspace-write"` (or `"full-auto"`) to `cf_run_participant`, or use `/consensflow:cf @name <prompt> --rw` / `--tools workspace-write`, for one run only. This keeps one roster entry and makes the escalation explicit.
- **After any write-capable run:** inspect what changed yourself (`git status`, `git diff`, relevant tests as needed), summarize what the participant changed, give your recommendation, and wait for user approval before keeping/building on/committing the changes unless the user pre-authorized that exact action.

## Invariants

- **One at a time.** Send to exactly one participant per call. Multiple leading `@mentions` are rejected; never fan out to several participants automatically. If the user names several, ask which one first, or ask one and wait for its answer before asking the next.
- **Safe by default, not review-only.** A participant runs without write tools unless it was explicitly configured with `--tools workspace-write` or `full-auto`, or that call passes `--rw` / `toolsPolicy: "workspace-write"`.
- **One-shot, no memory.** Each call is fresh. Continuity comes only from the handoff (re-sent each time), which already includes earlier `@participant` replies — so a later participant can build on an earlier one (cross-pollination). For a genuinely *independent* opinion, ask that participant **first**, before others have replied — otherwise its handoff carries the prior answers and colors it.
- **Foreground streaming is non-optional.** Every participant run streams its normalized thinking / tool-call / answer events into the Pi UI as it goes (via `cf_run_participant`'s `onUpdate`); this is structural — there is no flag or agent decision that can suppress it.
- **The lead is always the decision-maker.** ConsensFlow routes a prompt and returns an answer; it never implements anything on its own. Acting on any answer goes through the gate above.
- **No automatic git context.** Participants receive only the handoff and the prompt — paste a diff or name the files when you want them assessed or changed.
- **No hidden workflows.** Do not assume ceremonies like spec review, implementation review, council, grill, or handoff-by-name. The skill routes one prompt to one participant; that is all.
