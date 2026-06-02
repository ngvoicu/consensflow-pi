import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { collectGitDiff } from "./consensflow/lib/artifacts.js";
import { serializeTranscript } from "./consensflow/lib/handoff.js";
import { formatPresets, getPreset, listPresetIds, participantFromPreset } from "./consensflow/lib/presets.js";
import {
  cfRoot,
  configRoot,
  ensureCfDirs,
  getParticipant,
  loadCurrent,
  loadParticipants,
  removeParticipant,
  upsertParticipant,
} from "./consensflow/lib/state.js";
import { parseOptions, parseParticipantPrompt, slugify, tokenize } from "./consensflow/lib/utils.js";
import { runNamedParticipant } from "./consensflow/lib/workflows.js";

const EXT = "consensflow";

export default async function consensflow(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const participants = await loadParticipants(ctx.cwd).catch(() => []);
    ctx.ui.setStatus(EXT, `CF ${participants.length} participant${participants.length === 1 ? "" : "s"}`);
  });

  pi.on("input", async (event, ctx) => {
    const parsed = await parseTypedPrompt(event.text, ctx);
    if (!parsed) return;
    await ensureCfDirs(ctx.cwd);
    await handleParticipantPrompt(parsed, ctx, pi, ctx.signal);
    return { action: "handled" as const };
  });

  pi.registerCommand("cf", {
    description: "ConsensFlow: manage named participants or send a natural-language prompt to one participant",
    handler: async (args, ctx) => handleCf(args, ctx, pi),
  });

  pi.registerCommand("consensflow", {
    description: "Alias for /cf",
    handler: async (args, ctx) => handleCf(args, ctx, pi),
  });

  pi.registerCommand("participants", {
    description: "ConsensFlow participant management",
    handler: async (args, ctx) => handleCf(`participants ${args}`, ctx, pi),
  });

  pi.registerTool({
    name: "cf_list_participants",
    label: "CF Participants",
    description: "List globally configured ConsensFlow named participants.",
    promptSnippet: "List named ConsensFlow participants available for one-at-a-time natural-language prompts.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const participants = await loadParticipants(ctx.cwd);
      return { content: [{ type: "text", text: formatParticipants(participants) }], details: { participants, configRoot: configRoot() } };
    },
  });

  pi.registerTool({
    name: "cf_run_participant",
    label: "CF Ask Participant",
    description: "Send one natural-language prompt to one named ConsensFlow participant. The participant receives the current session as a handoff plus your prompt, runs with its configured tools, and returns an artifact.",
    promptSnippet: "Send a natural-language prompt to exactly one named ConsensFlow participant, then use the returned artifact for your own synthesis.",
    parameters: Type.Object({
      participant: Type.String({ description: "Participant name or @mention, e.g. @zeus" }),
      prompt: Type.String({ description: "Natural-language request for that participant" }),
      context: Type.Optional(Type.String({ description: "Optional focused note/brief added on top of the auto-included session handoff." })),
      includeHandoff: Type.Optional(Type.Boolean({ description: "Attach the current session transcript as context. Defaults to true." })),
      includeLatestChanges: Type.Optional(Type.Boolean({ description: "Include git status/diff context. Defaults to a prompt heuristic." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Optional timeout override" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const participant = await getParticipant(ctx.cwd, params.participant);
      if (!participant) throw new Error(`Unknown participant: ${params.participant}`);
      onUpdate?.({ content: [{ type: "text", text: `Asking @${participant.id}...` }] });
      const includeDiff = params.includeLatestChanges ?? shouldIncludeLatestChanges(params.prompt);
      const diff = includeDiff ? await collectGitDiffForPacket(ctx.cwd, pi, signal) : undefined;
      const result = await runNamedParticipant({
        cwd: ctx.cwd,
        participantRef: participant,
        kind: "ask",
        task: params.prompt,
        diff,
        handoff: (params.includeHandoff ?? true) ? collectHandoff(ctx) : "",
        extraContext: params.context,
        signal,
        timeoutMs: params.timeoutMs,
      });
      return { content: [{ type: "text", text: renderRunResult(result) }], details: result };
    },
  });

  await registerParticipantCommands(pi);
}

const RESERVED_COMMAND_NAMES = new Set(["cf", "consensflow", "participants"]);

// Register a dedicated `/<id>` command per configured participant so you can talk to them
// directly (e.g. `/zeus ...`), instead of only the generic `/cf @zeus ...`. Participants are
// global, so this runs once at load; new participants get their command after `/reload`.
async function registerParticipantCommands(pi: ExtensionAPI) {
  let participants: any[] = [];
  try {
    participants = await loadParticipants(process.cwd());
  } catch {
    return;
  }
  const taken = new Set(RESERVED_COMMAND_NAMES);
  try {
    for (const command of pi.getCommands()) taken.add(command.name);
  } catch {
    // getCommands may be unavailable mid-load; reserved set still guards the obvious clashes.
  }
  for (const participant of participants) {
    const name = participant.id;
    if (taken.has(name)) continue; // never shadow a built-in or another participant's command
    try {
      pi.registerCommand(name, {
        description: `ConsensFlow: ask @${participant.id}${participant.model ? ` (${participant.kind} ${participant.model})` : ""}`,
        handler: async (args, ctx) => {
          const prompt = String(args ?? "").trim();
          if (!prompt) {
            ctx.ui.notify(`Usage: /${name} <prompt>`, "warning");
            return;
          }
          await ensureCfDirs(ctx.cwd);
          await handleParticipantPrompt({ participant: participant.id, prompt }, ctx, pi, ctx.signal);
        },
      });
      taken.add(name);
    } catch {
      // Skip on duplicate/registration error; @mention and /cf remain available as fallbacks.
    }
  }
}

async function handleCf(args: string, ctx: any, pi: ExtensionAPI) {
  try {
    await ensureCfDirs(ctx.cwd);
    const tokens = tokenize(args);
    if (tokens.length === 0) return await handleStatus(ctx, pi);

    const known = await knownParticipantKeys(ctx.cwd);
    const directPrompt = parseParticipantPrompt(tokens, known);
    if (directPrompt) return await handleParticipantPrompt(directPrompt, ctx, pi, ctx.signal);

    const command = tokens.shift() ?? "status";
    switch (command) {
      case "status":
      case "state":
        return await handleStatus(ctx, pi);
      case "doctor":
        return await handleDoctor(ctx, pi);
      case "participants":
      case "participant":
        return await handleParticipants(tokens, ctx, pi);
      case "ask":
      case "to": {
        const parsed = parseParticipantPrompt(tokens, known);
        if (!parsed) throw new Error("Usage: /cf @name <prompt> or /cf ask @name <prompt>");
        return await handleParticipantPrompt(parsed, ctx, pi, ctx.signal);
      }
      case "help":
      default:
        return sendCfMessage(pi, helpText(), { command: "help" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`ConsensFlow error: ${message}`, "error");
    sendCfMessage(pi, `# ConsensFlow error\n\n${message}`, { error: message });
  }
}

async function handleStatus(ctx: any, pi: ExtensionAPI) {
  const participants = await loadParticipants(ctx.cwd);
  const current = await loadCurrent(ctx.cwd);
  const markdown = [
    "# ConsensFlow status",
    "",
    `Config root: ${configRoot()}`,
    `Artifact root for this workspace: ${cfRoot(ctx.cwd)}`,
    `Participants: ${participants.length}`,
    `Latest run: ${current.latestRunId ?? "none"}`,
    "",
    formatParticipants(participants),
  ].join("\n");
  sendCfMessage(pi, markdown, { participants, current, configRoot: configRoot(), artifactRoot: cfRoot(ctx.cwd) });
}

async function handleDoctor(ctx: any, pi: ExtensionAPI) {
  const binaries = ["pi", "claude", "codex", "opencode"];
  const rows = [];
  for (const binary of binaries) {
    const result = await pi.exec(binary, ["--version"], { timeout: 5000 });
    rows.push({ binary, ok: result.code === 0, output: (result.stdout || result.stderr || "").trim() });
  }
  const markdown = [
    "# ConsensFlow doctor",
    "",
    `Config root: ${configRoot()}`,
    "",
    ...rows.map((row) => `- ${row.ok ? "✓" : "✗"} ${row.binary}: ${row.output || "not available"}`),
  ].join("\n");
  sendCfMessage(pi, markdown, { rows, configRoot: configRoot() });
}

async function handleParticipants(tokens: string[], ctx: any, pi: ExtensionAPI) {
  const sub = tokens.shift() ?? "list";
  if (sub === "list") {
    const participants = await loadParticipants(ctx.cwd);
    return sendCfMessage(pi, formatParticipants(participants), { participants, configRoot: configRoot() });
  }
  if (sub === "presets" || sub === "preset") {
    return sendCfMessage(pi, formatPresets(), { presets: listPresetIds() });
  }
  if (sub === "show") {
    const ref = tokens[0];
    if (!ref) throw new Error("Usage: /cf participants show @name");
    const participant = await getParticipant(ctx.cwd, ref);
    if (!participant) throw new Error(`Unknown participant: ${ref}`);
    return sendCfMessage(pi, `# ${participant.name}\n\n\`\`\`json\n${JSON.stringify(participant, null, 2)}\n\`\`\``, { participant });
  }
  if (sub === "remove" || sub === "rm") {
    const ref = tokens[0];
    if (!ref) throw new Error("Usage: /cf participants remove @name");
    const removed = await removeParticipant(ctx.cwd, ref);
    ctx.ui.notify(removed ? `Removed ${ref}` : `No participant matched ${ref}`, removed ? "info" : "warning");
    return sendCfMessage(pi, removed ? `Removed ${ref}.` : `No participant matched ${ref}.`, { removed, ref });
  }
  if (sub === "add") {
    const parsed = parseOptions(tokens);
    const presetRef = parsed.positional[0];

    // Add every preset at once.
    if (presetRef === "all") {
      assertPresetOverrideFlags(parsed.flags);
      const participants = [];
      for (const presetId of listPresetIds()) {
        participants.push(await upsertParticipant(ctx.cwd, participantFromPreset(presetId, presetOverrides(parsed.flags))));
      }
      ctx.ui.notify(`Saved ${participants.length} ConsensFlow participants`, "info");
      return sendCfMessage(pi, `Saved presets in ${configRoot()}.\n\n${participants.map(formatParticipantLine).join("\n")}\n\n${reloadHint()}`, { participants, configRoot: configRoot() });
    }

    // Preset path: positional names a known preset; --name optionally renames it.
    if (presetRef && getPreset(presetRef)) {
      assertPresetOverrideFlags(parsed.flags);
      const participant = await upsertParticipant(ctx.cwd, participantFromPreset(presetRef, presetOverrides(parsed.flags)));
      ctx.ui.notify(`Saved @${participant.id}`, "info");
      const from = participant.preset && participant.preset !== participant.id ? ` from preset \`${participant.preset}\`` : "";
      return sendCfMessage(pi, `Saved participant @${participant.id}${from} in ${configRoot()}.\n\n${formatParticipantLine(participant)}\n\n${reloadHint()}`, { participant, configRoot: configRoot() });
    }

    // Custom path: explicit custom intent via --name or any backend flag. A positional serves as the name.
    if (stringFlag(parsed.flags.name) !== undefined || hasCustomShape(parsed.flags)) {
      assertCustomAddFlags(parsed.flags);
      const name = stringFlag(parsed.flags.name) ?? presetRef;
      if (!name) throw new Error("Custom participant needs a name: /cf participants add --name <name> --kind <kind> --model <model> ...");
      const participant = await upsertParticipant(ctx.cwd, customParticipantInput(name, parsed.flags));
      ctx.ui.notify(`Saved @${participant.id}`, "info");
      return sendCfMessage(pi, `Saved custom participant @${participant.id} in ${configRoot()}.\n\n${formatParticipantLine(participant)}\n\n${reloadHint()}`, { participant, configRoot: configRoot() });
    }

    if (presetRef) {
      throw new Error(`Unknown preset: ${presetRef}\n\nPresets: ${listPresetIds().join(", ")} (rename any with --name).\n\nOr create a custom participant:\n  /cf participants add --name <name> --kind <pi|claude-code|codex|opencode> --model <model> [--effort <e>] [--roles <r>] [--tools <readonly|workspace-write|full-auto>]`);
    }
    throw new Error(addUsage());
  }
  throw new Error("Usage: /cf participants list|presets|add|show|remove");
}

async function handleParticipantPrompt(parsed: ParticipantPrompt, ctx: any, pi: ExtensionAPI, signal?: AbortSignal) {
  if (parsed.error) throw new Error(parsed.error);
  const participant = await getParticipant(ctx.cwd, parsed.participant);
  if (!participant) throw new Error(`Unknown participant: @${parsed.participant}`);
  ctx.ui.notify(`Asking @${participant.id}...`, "info");
  const includeDiff = shouldIncludeLatestChanges(parsed.prompt);
  const diff = includeDiff ? await collectGitDiffForPacket(ctx.cwd, pi, signal) : undefined;
  const result = await runNamedParticipant({
    cwd: ctx.cwd,
    participantRef: participant,
    kind: "ask",
    task: parsed.prompt,
    diff,
    handoff: collectHandoff(ctx),
    signal,
  });
  // Record the prompt in details so later participants' handoffs can reconstruct this exchange
  // (the @mention input was "handled" and is never stored as a normal session message).
  sendCfMessage(pi, renderRunResult(result), { ...result, prompt: parsed.prompt });
}

const HANDOFF_MAX_BYTES = 120 * 1024;

// Pull the current resolved session transcript on-demand from the read-only session manager and
// serialize it for the participant handoff. On-demand (not cached) so it stays correct across
// fork / tree navigation / session switch. Degrades to "" if unavailable.
function collectHandoff(ctx: any): string {
  try {
    const sessionManager = ctx?.sessionManager;
    if (!sessionManager || typeof sessionManager.getBranch !== "function") return "";
    return serializeTranscript(sessionManager.getBranch(), { maxBytes: HANDOFF_MAX_BYTES });
  } catch {
    return "";
  }
}

type ParticipantPrompt = { participant: string; prompt: string; error?: undefined } | { participant?: undefined; prompt?: undefined; error: string };

// Tokenize a typed line and decide whether it addresses one participant. When the line contains
// any `@token`, load the configured participants so a single non-leading mention (`hi @zeus`)
// routes only when it names a real participant — a stray `@types/node` is left for the lead.
async function parseTypedPrompt(text: string, ctx: any): Promise<ParticipantPrompt | null> {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || trimmed.startsWith("/")) return null;
  const tokens = tokenize(trimmed);
  if (!tokens.some((token) => token.startsWith("@"))) return null;
  return parseParticipantPrompt(tokens, await knownParticipantKeys(ctx.cwd));
}

// Slugified ids + names of every configured participant, matching getParticipant's resolution.
async function knownParticipantKeys(cwd: string): Promise<Set<string>> {
  const participants = await loadParticipants(cwd).catch(() => []);
  return new Set((participants as any[]).flatMap((p) => [p.id, slugify(p.name)]).filter(Boolean));
}

function shouldIncludeLatestChanges(prompt: string) {
  return /\b(latest changes?|recent changes?|diff|git diff|patch|review changes?|changed files?|implementation)\b/i.test(prompt);
}

async function collectGitDiffForPacket(cwd: string, pi: ExtensionAPI, signal?: AbortSignal) {
  return await collectGitDiff(cwd, (command, args, options = {}) => pi.exec(command, args, { ...options, signal, timeout: options.timeout ?? 10_000 }));
}

const PRESET_OVERRIDE_FLAGS = ["name", "id", "cwd", "timeoutMs", "description"];
const CUSTOM_ADD_FLAGS = ["name", "id", "kind", "model", "provider", "effort", "thinking", "roles", "tools", "toolsPolicy", "skills", "skillsPolicy", "agent", "cwd", "timeoutMs", "maxTurns", "description"];
const CUSTOM_SHAPE_FLAGS = ["kind", "model", "provider", "effort", "thinking", "roles", "tools", "toolsPolicy", "skills", "skillsPolicy", "agent", "maxTurns"];

function assertAllowedFlags(flags: Record<string, unknown>, allowed: string[], context: string) {
  const allowedSet = new Set(allowed);
  const rejected = Object.keys(flags).filter((flag) => !allowedSet.has(flag));
  if (rejected.length > 0) {
    throw new Error(`Unsupported ${context} option(s): ${rejected.map((flag) => `--${flag}`).join(", ")}. Allowed: ${allowed.map((flag) => `--${flag}`).join(", ")}.`);
  }
}

function assertPresetOverrideFlags(flags: Record<string, unknown>) {
  assertAllowedFlags(flags, PRESET_OVERRIDE_FLAGS, "preset add");
}

function assertCustomAddFlags(flags: Record<string, unknown>) {
  assertAllowedFlags(flags, CUSTOM_ADD_FLAGS, "custom add");
}

function hasCustomShape(flags: Record<string, unknown>) {
  return CUSTOM_SHAPE_FLAGS.some((flag) => stringFlag(flags[flag]) !== undefined);
}

function stringFlag(value: unknown) {
  if (value === undefined || value === null || value === true) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function presetOverrides(flags: Record<string, unknown>) {
  return { name: flags.name, id: flags.id, cwd: flags.cwd, timeoutMs: flags.timeoutMs, description: flags.description };
}

function customParticipantInput(name: string, flags: Record<string, unknown>) {
  return {
    name,
    id: flags.id,
    kind: flags.kind,
    model: flags.model,
    provider: flags.provider,
    effort: flags.effort,
    thinking: flags.thinking,
    roles: flags.roles,
    toolsPolicy: flags.tools ?? flags.toolsPolicy,
    skillsPolicy: flags.skills ?? flags.skillsPolicy,
    agent: flags.agent,
    cwd: flags.cwd,
    timeoutMs: flags.timeoutMs,
    maxTurns: flags.maxTurns,
    description: flags.description,
  };
}

function reloadHint() {
  return "Tip: run `/reload` so each participant gets its own `/<name>` slash command (or it loads next session).";
}

function addUsage() {
  return [
    "Usage:",
    "  /cf participants add <preset> [--name <name>]        # from a preset, optionally renamed",
    "  /cf participants add all                              # every preset",
    "  /cf participants add --name <name> --kind <pi|claude-code|codex|opencode> --model <model> [--effort <e>] [--thinking <t>] [--roles <r>] [--tools <readonly|workspace-write|full-auto>] [--cwd <subdir>]",
    "",
    `Presets: ${listPresetIds().join(", ")}`,
  ].join("\n");
}

function formatParticipants(participants: any[]) {
  if (participants.length === 0) {
    return [
      "# ConsensFlow participants",
      "",
      `Config root: ${configRoot()}`,
      "",
      "No participants configured yet.",
      "",
      "Create participants:",
      "```text",
      "/cf participants presets",
      "/cf participants add zeus                     # from a preset",
      "/cf participants add zeus --name Deepreview   # preset backend, custom name",
      "/cf participants add all                      # every preset",
      "/cf participants add --name Builder --kind codex --model gpt-5.5 --roles implementer --tools workspace-write",
      "```",
    ].join("\n");
  }
  return ["# ConsensFlow participants", "", `Config root: ${configRoot()}`, "", ...participants.map(formatParticipantLine)].join("\n");
}

function formatParticipantLine(p: any) {
  const model = p.model ? ` model=${p.model}` : "";
  const effort = p.effort ? ` effort=${p.effort}` : p.thinking ? ` thinking=${p.thinking}` : "";
  const cwd = p.cwd ? ` cwd=${p.cwd}` : "";
  const skills = p.kind === "pi" ? ` skills=${p.skillsPolicy ?? "default"}` : "";
  const preset = p.preset ? ` preset=${p.preset}` : "";
  return `- @${p.id} (${p.kind}${model}${effort}${cwd}${skills}${preset}) roles=${(p.roles ?? []).join(",") || "-"} tools=${p.toolsPolicy}`;
}

function renderRunResult(result: any) {
  return [`# @${result.participant.id}`, "", `Run: ${result.runId}`, `Exit: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`, `Artifacts: ${result.runDir}`, "", result.output].join("\n");
}

function sendCfMessage(pi: ExtensionAPI, content: string, details?: any) {
  pi.sendMessage({ customType: EXT, content, display: true, details });
}

function helpText() {
  return `# ConsensFlow help

Natural-language prompts to one participant at a time. Each participant gets the current
session as a handoff plus your prompt, and answers conversationally.

Ask a participant (all equivalent):

\`\`\`text
/zeus What do you think about this approach?      # dedicated per-participant command
@zeus What do you think about this approach?      # bare mention
/cf @zeus What do you think about this approach?  # generic router
\`\`\`

Add participants (config is global, ${configRoot()}/participants.json):

\`\`\`text
/cf participants add zeus                          # from a preset
/cf participants add zeus --name Deepreview        # preset backend, your own name -> /deepreview
/cf participants add all                           # every preset
/cf participants add --name Builder --kind codex --model gpt-5.5 --effort high \\
    --roles implementer --tools workspace-write    # fully custom
\`\`\`

Admin commands:

- \`/cf status\`
- \`/cf doctor\`
- \`/cf participants list|presets|add|show|remove\`

Rules:

- Send to one participant at a time.
- A participant runs with its configured tools (a \`workspace-write\`/\`full-auto\` participant can
  edit and run); participants whose roles are purely advisory (reviewer/council/knowledge) are
  always forced read-only.
- One-shot: participants do not remember previous calls; each call re-sends the current session handoff.
- New participants get their \`/<name>\` command after \`/reload\` or next session; \`@name\` works immediately.
- The current Pi session remains the lead and decides what to implement.
`;
}
