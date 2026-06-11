---
name: consensflow
description: Use ConsensFlow inside Pi to consult one named participant (an external coding-agent CLI, run one-shot) for a review, second opinion, design critique, questions, or help. Activate whenever the user asks a named agent for input OR whenever the lead itself should reach for an advisor (e.g. before finalizing a non-trivial design or diff). Consulting is free and encouraged; acting on a participant's response or keeping its file changes is gated behind explicit user approval unless the user already authorized it.
---

# ConsensFlow

ConsensFlow lets the lead (this Pi session) consult one named participant at a time. A participant is an external coding-agent CLI (claude / codex / opencode / pi) run as an isolated one-shot subprocess: it receives a handoff of the current session plus a prompt, answers once, and does not persist between calls. Talking to a participant is like phoning an advisor — the lead stays the decision-maker and ConsensFlow never implements anything on its own.

## The two rules that matter most

These two rules are the heart of the skill. They pull in opposite directions on purpose: consulting is cheap and encouraged; acting on the result is gated.

### 1. Consulting is free — and encouraged

The lead may, and should, reach for a participant on its own initiative, with NO user permission needed merely to consult. Treat a participant review as a natural reflex, not a rare ceremony — before finalizing a non-trivial design or diff, consider getting a participant review. Just call `cf_run_participant`; you do not ask the user "may I consult X?" first. Good moments, with the kind of prompt to send:

- **Before finalizing a non-trivial design or diff** — `@zeus` "Review this approach; call out the riskiest assumption and anything you'd do differently."
- **To stress-test a plan** — `@athena` "Poke holes in this migration plan — what breaks under load or on rollback?"
- **To surface unknowns before building** — `@iris` "What questions should I answer before I start implementing this?"
- **For a quick gut-check or tie-breaker** — `@luna` "Does this error handling read as correct to you — yes/no with one reason?"
- **For a focused diff review** — mention "latest changes" so git status + diff are attached automatically.

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

Participants are configured globally under `~/.consensflow/participants.json` (set up once, use from any project). They come from curated presets or fully custom definitions:

```text
/cf participants presets                      # list built-in presets
/cf participants add zeus                      # add a preset            → @zeus, /zeus
/cf participants add all                       # add every preset
/cf participants add zeus --name Deepreview    # preset backend, renamed → @deepreview, /deepreview
/cf participants add --name Builder --kind codex --model gpt-5.5 --effort high \
    --roles implementer --tools workspace-write   # fully custom, write-capable
```

Presets (all read-only reviewers; the same model+effort family exists on every engine that runs it):

- **Fable 5** (Anthropic's top model — use for the questions that really matter): `@calliope`/`@clio`/`@thalia` (Claude Code max/xhigh/medium), `@orpheus`/`@erato` (Pi xhigh/medium, Anthropic auth), `@saga`/`@kvasir` (OpenCode xhigh/medium via OpenRouter).
- **Opus 4.8**: `@zeus`/`@apollo`/`@artemis` (Claude Code max/xhigh/medium), `@kronos`/`@atlas` (Pi xhigh/medium, Anthropic auth), `@baldr`/`@vali` (OpenCode xhigh/medium via OpenRouter; xhigh is the ceiling outside claude-code).
- **GPT 5.5**: `@athena`/`@perseus`/`@loki` (Codex xhigh/high/medium), `@iris`/`@hermes`/`@eos` (Pi xhigh/high/medium), `@forseti`/`@bragi`/`@ullr` (OpenCode xhigh/high/medium via OpenRouter).
- **Deep open-weights**: `@luna` (OpenCode Kimi K2.6).
- **Fast/cheap tier** (quick gut-checks): `@hermod` (Claude Haiku 4.5), `@nike`/`@sif` (Gemini 3.5 Flash on Pi/OpenCode), `@zephyros`/`@freya` (DeepSeek V4 Flash on Pi/OpenCode).
- **Model zoo** (same OpenRouter models on two engines; Greek = pi, Norse = opencode): DeepSeek V4 Pro `@hades`/`@odin`, Gemini 3.1 Pro `@helios`/`@heimdall`, Grok 4.3 `@ares`/`@thor`, Qwen3.7 Max `@hephaestus`/`@tyr`, Llama 4 Maverick `@pan`/`@vidar`, Mistral Large `@aeolus`/`@njord`, MiniMax M3 `@metis`/`@mimir`.
- **Image**: `@pygmalion` (kind=image) generates a picture with gpt-image-2 via your existing openai-codex login — prompt-only (no handoff), saved to `.consensflow/runs` and shown inline.

Run `/cf participants presets` for the full list. Model and effort strings pass through to the engine verbatim, so any identifier the engine accepts works.

## How to ask

Each configured participant gets a dedicated `/<name>` command; `@name` (anywhere in the line) and `/cf @name` also work:

```text
@zeus What's the riskiest part of this design?            # mention, anywhere in the line
/zeus What's the riskiest part of this design?            # dedicated command (after /reload)
/cf @zeus What's the riskiest part of this design?        # generic router
```

A newly added participant's `/<name>` command becomes available after `/reload` in a running session; `@name` and `/cf @name` work immediately, and a fresh Pi session picks up the command automatically. A stray `@token` that is not a participant is ignored and goes to the lead as normal text.

From the lead, **prefer the `cf_run_participant` tool.** Pass an optional `context` brief on top of the auto-included session handoff to focus the participant on exactly what you want reviewed.

## Tools available to the lead

- `cf_list_participants` — see who is configured.
- `cf_run_participant` — send one prompt to one participant (optional `context` brief on top of the auto handoff). The preferred path when the lead consults on its own initiative.

## Invariants

- **One at a time.** Send to exactly one participant per call. Multiple leading `@mentions` are rejected; never fan out to several participants automatically. If the user names several, ask which one first, or ask one and wait for its answer before asking the next.
- **Read-only by default.** A participant reads but does not write unless explicitly made write-capable. Advisory roles (`reviewer` / `council` / `knowledge`) are *always* forced read-only by policy; write flags never reach them.
- **One-shot, no memory.** Each call is fresh. Continuity comes only from the handoff (re-sent each time), which already includes earlier `@participant` replies — so a later participant can build on an earlier one (cross-pollination). For a genuinely *independent* opinion, ask that participant **first**, before others have replied — otherwise its handoff carries the prior answers and colors it.
- **No live/shared transcript.** Participants get a one-shot serialized handoff, not a streamed or shared session. There is no shared room and no ACP architecture.
- **The lead is always the decision-maker.** ConsensFlow routes a prompt and returns an answer; it never implements anything on its own. Acting on any answer goes through the gate above.
- **Latest changes.** If the prompt mentions latest changes / diff / patch / changed files, git status + diff context is attached automatically.
- **No hidden workflows.** Do not assume ceremonies like spec review, implementation review, council, grill, or handoff-by-name. The skill routes one prompt to one participant; that is all.
