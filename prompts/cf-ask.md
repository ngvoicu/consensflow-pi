---
description: Ask one ConsensFlow participant with a natural-language prompt
argument-hint: "@participant <prompt>"
---
Send one natural-language prompt to one ConsensFlow participant:

```text
/cf $@
```

Rules:

- Use exactly one configured participant mention (a preset like @zeus or any custom participant). Each also has a dedicated `/<name>` command.
- Do not invent hidden workflows such as spec review, council, grill, or handoff.
- If you need another opinion, ask another participant after the first answer returns.
