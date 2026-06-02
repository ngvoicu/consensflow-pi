---
name: consensflow
description: Use ConsensFlow inside Pi to send one natural-language prompt to one configured named participant (preset like Zeus/Athena, or a custom one Gabriel defined). Use when Gabriel asks a named agent for an opinion, review, questions, feedback, or to act on a task. Do not use for multi-agent councils or hidden spec/review workflows unless Gabriel explicitly asks to build that later.
---

# ConsensFlow

ConsensFlow is a Pi-native named-agent prompt router. Talking to a participant is like calling an
advisor: it receives a handoff of the current session plus Gabriel's prompt, answers once, and does
not persist between calls.

## Principles

- The current Pi session is the lead and decision maker.
- Participants are globally configured under `~/.consensflow`, not per project.
- Participants come from curated presets OR are defined custom (any kind/model/effort/roles/tools); presets can also be renamed.
- Send to exactly one participant at a time.
- The participant receives a packet with: who they are, a mode line, a handoff of the current session, Gabriel's prompt, and optional git diff. It does not get a live shared transcript — it is a one-shot subagent, not a persistent chat peer.
- A participant runs with its configured tools. A `workspace-write`/`full-auto` participant can edit files and run commands; participants whose roles are purely advisory (reviewer/council/knowledge) are always forced read-only.
- Do not assume hidden workflows like spec review, implementation review, council, grill, or handoff-by-name.
- If Gabriel asks about "latest changes", include/use git diff context when available.

## Creating participants

```text
/cf participants presets
/cf participants add zeus                     # from a preset (Claude Code Opus 4.8 MAX)
/cf participants add zeus --name Deepreview   # preset backend, custom name -> @deepreview, /deepreview
/cf participants add all                      # every preset
/cf participants add --name Builder --kind codex --model gpt-5.5 --effort high \
    --roles implementer --tools workspace-write   # fully custom, write-capable
```

Presets — house team: zeus/apollo (Claude Code Opus 4.8), athena (Codex GPT 5.5), iris (Pi GPT 5.5), luna (OpenCode Kimi K2.6).
Fast tier: hermod (Claude Haiku), loki (Codex medium), nike (Pi Gemini Flash), freya (OpenCode DeepSeek Flash).
Model zoo (same OpenRouter models, Greek = pi / Norse = opencode): DeepSeek V4 Pro hades/odin, Gemini 3.1 Pro helios/heimdall, Grok 4.3 ares/thor, Qwen3.7 Max hephaestus/tyr, Llama 4 Maverick pan/vidar, Mistral Large aeolus/njord, MiniMax M3 metis/mimir. Run `/cf participants presets` for the full list.

## Usage

Each configured participant gets its own `/<name>` command; `@name` and `/cf @name` also work.

```text
/zeus What do you think about this approach?
@athena Review the latest changes and list blockers only.
/cf ask @iris What questions should I answer before implementing this?
```

From the lead, prefer the `cf_run_participant` tool; pass an optional `context` brief on top of the
auto-included session handoff.

## Tools available to the Pi lead

- `cf_list_participants`
- `cf_run_participant`

When Gabriel mentions multiple participants, do not fan out automatically. Ask which one to send to first, or send to one and wait for the answer before asking another.
