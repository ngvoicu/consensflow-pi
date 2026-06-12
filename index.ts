import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { serializeTranscript } from "./extensions/consensflow/lib/handoff.js";
import { decodeChatGptAccountId, generateImage, IMAGE_TRIGGER_DEFAULT, saveImagePng } from "./extensions/consensflow/lib/image.js";
import { formatPresets, getPreset, listPresetIds, participantFromPreset } from "./extensions/consensflow/lib/presets.js";
import {
  cfRoot,
  configRoot,
  ensureCfDirs,
  getParticipant,
  loadCurrent,
  loadParticipants,
  recordLatestRun,
  removeParticipant,
  runsRoot,
  upsertParticipant,
} from "./extensions/consensflow/lib/state.js";
import { createId, parseOptions, parseParticipantPrompt, slugify, tokenize } from "./extensions/consensflow/lib/utils.js";
import { effectiveToolsPolicy, runNamedParticipant } from "./extensions/consensflow/lib/workflows.js";

const EXT = "consensflow";

export default async function consensflow(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const participants = await loadParticipants(ctx.cwd).catch(() => []);
    ctx.ui.setStatus(EXT, `CF ${participants.length} participant${participants.length === 1 ? "" : "s"}`);
  });

  pi.on("input", async (event, ctx) => {
    const parsed = await parseTypedPrompt(event.text, ctx);
    if (!parsed) return;
    try {
      await ensureCfDirs(ctx.cwd);
      await handleParticipantPrompt(parsed, ctx, pi, ctx.signal);
    } catch (error) {
      reportCfError(pi, ctx, error);
    }
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
    description: "Consult one named ConsensFlow participant as an advisor. It receives the current session as a handoff plus your prompt, runs with its configured tools, and returns its answer. Use this freely and on your own initiative to get reviews, second opinions, questions, or help — you do not need the user's permission to consult. But do NOT apply, merge, commit, adopt, or otherwise act on what it returns — neither its advice nor a write-capable participant's file changes — without first showing the user (a summary plus your recommendation) and getting their approval, unless the user has already told you to proceed.",
    promptSnippet: "Consult one named ConsensFlow participant as an advisor (asking is free — no user permission needed). Then report its answer to the user and get approval before acting on it: never apply a participant's advice or changes unprompted unless the user already said to proceed.",
    parameters: Type.Object({
      participant: Type.String({ description: "Participant name or @mention, e.g. @zeus" }),
      prompt: Type.String({ description: "Natural-language request for that participant" }),
      context: Type.Optional(Type.String({ description: "Optional focused note/brief added on top of the auto-included session handoff." })),
      includeHandoff: Type.Optional(Type.Boolean({ description: "Attach the current session transcript as context. Defaults to true." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Optional timeout override" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const participant = await getParticipant(ctx.cwd, params.participant);
      if (!participant) throw new Error(`Unknown participant: ${params.participant}`);
      if (participant.kind === "image") {
        onUpdate?.({ content: [{ type: "text", text: `Generating image with @${participant.id} (gpt-image-2)...` }] });
        const r = await generateImageArtifact(ctx, participant, params.prompt, signal);
        return {
          content: [
            { type: "text", text: imageSummary(participant, r) },
            { type: "image", data: r.base64, mimeType: r.mimeType },
          ],
          details: { runId: r.runId, savedPath: r.savedPath, revisedPrompt: r.revisedPrompt, participant: { id: participant.id, kind: participant.kind } },
        };
      }
      onUpdate?.({ content: [{ type: "text", text: `Asking @${participant.id}...` }] });
      const includeHandoff = params.includeHandoff ?? true;
      const handoff = includeHandoff ? collectHandoff(ctx) : "";
      const result = await runNamedParticipant({
        cwd: ctx.cwd,
        participantRef: participant,
        kind: "ask",
        task: params.prompt,
        handoff,
        extraContext: params.context,
        signal,
        timeoutMs: params.timeoutMs,
      });
      result.handoffSummary = summarizeHandoff(handoff, includeHandoff);
      return { content: [{ type: "text", text: `${renderRunResult(result)}\n\n${CONSULT_REMINDER}` }], details: result };
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
          try {
            await ensureCfDirs(ctx.cwd);
            await handleParticipantPrompt({ participant: participant.id, prompt }, ctx, pi, ctx.signal);
          } catch (error) {
            reportCfError(pi, ctx, error);
          }
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
    reportCfError(pi, ctx, error);
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
  const KIND_BINARY: Record<string, string> = { pi: "pi", "claude-code": "claude", codex: "codex", opencode: "opencode" };
  const binaries = ["pi", "claude", "codex", "opencode"];
  const participants = (await loadParticipants(ctx.cwd).catch(() => [])) as any[];
  const neededBy: Record<string, string[]> = {};
  for (const p of participants) {
    const binary = KIND_BINARY[p.kind];
    if (binary) (neededBy[binary] ??= []).push(`@${p.id}`);
  }
  const rows = [];
  for (const binary of binaries) {
    const result = await pi.exec(binary, ["--version"], { timeout: 5000 });
    rows.push({ binary, ok: result.code === 0, output: (result.stdout || result.stderr || "").trim(), neededBy: neededBy[binary] ?? [] });
  }
  const imageParticipants = participants.filter((p) => p.kind === "image").map((p) => `@${p.id}`);
  const missing = rows.filter((row) => !row.ok && row.neededBy.length > 0);
  const lines = [
    "# ConsensFlow doctor",
    "",
    `Config root: ${configRoot()}`,
    "",
    ...rows.map((row) => {
      const need = row.neededBy.length > 0 ? ` — needed by ${row.neededBy.join(", ")}` : " — not used by any participant";
      return `- ${row.ok ? "✓" : "✗"} ${row.binary}: ${row.output || "not available"}${need}`;
    }),
  ];
  if (imageParticipants.length > 0) {
    lines.push("", `- image participants (${imageParticipants.join(", ")}) need an \`openai-codex\` login (\`/login\` → ChatGPT Plus/Pro), not a CLI binary.`);
  }
  if (missing.length > 0) {
    lines.push("", "Missing engines that configured participants need:", ...missing.map((row) => `  - ${row.binary} (needed by ${row.neededBy.join(", ")})`));
  }
  sendCfMessage(pi, lines.join("\n"), { rows, imageParticipants, configRoot: configRoot() });
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
      // `--name`/`--id` would make every preset derive the same id and overwrite each other (saving
      // one participant while reporting "Saved 24"). Only allow flags that apply uniformly to a bulk add.
      assertAllowedFlags(parsed.flags, ["cwd", "timeoutMs", "description"], "preset add all");
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
      throw new Error(`Unknown preset: ${presetRef}\n\nPresets: ${listPresetIds().join(", ")} (rename any with --name).\n\nOr create a custom participant:\n  /cf participants add --name <name> --kind <pi|claude-code|codex|opencode|image> --model <model> [--effort <e>] [--roles <r>] [--tools <readonly|workspace-write|full-auto>]`);
    }
    throw new Error(addUsage());
  }
  throw new Error("Usage: /cf participants list|presets|add|show|remove");
}

async function handleParticipantPrompt(parsed: ParticipantPrompt, ctx: any, pi: ExtensionAPI, signal?: AbortSignal) {
  if (parsed.error) throw new Error(parsed.error);
  const participant = await getParticipant(ctx.cwd, parsed.participant);
  if (!participant) throw new Error(`Unknown participant: @${parsed.participant}`);
  if (participant.kind === "image") return await runImageParticipant(participant, parsed.prompt, ctx, pi, signal);
  ctx.ui.notify(`Asking @${participant.id}...`, "info");
  const handoff = collectHandoff(ctx);
  const result = await runNamedParticipant({
    cwd: ctx.cwd,
    participantRef: participant,
    kind: "ask",
    task: parsed.prompt,
    handoff,
    signal,
  });
  result.handoffSummary = summarizeHandoff(handoff, true);
  // Record the prompt in details so later participants' handoffs can reconstruct this exchange
  // (the @mention input was "handled" and is never stored as a normal session message).
  sendCfMessage(pi, renderRunResult(result), { ...result, prompt: parsed.prompt });
}

// --- Image participants (kind: "image") ---------------------------------
// Image generation doesn't fit the text-CLI runner: it calls the Codex Responses
// backend (gpt-image-2) over HTTP — reusing the openai-codex login — and returns
// an image. Handled here, not in runners.js, because it needs ctx.modelRegistry.
// The image model gets the prompt verbatim (no packet/handoff).
async function generateImageArtifact(ctx: any, participant: any, prompt: string, signal?: AbortSignal) {
  const token = await ctx?.modelRegistry?.getApiKeyForProvider?.("openai-codex");
  if (!token) {
    throw new Error("No openai-codex login found. Run /login and pick ChatGPT Plus/Pro (Codex) to use image participants.");
  }
  const accountId = decodeChatGptAccountId(token);
  await ensureCfDirs(ctx.cwd);
  const runId = createId("image");
  const runDir = path.join(runsRoot(ctx.cwd), runId);
  await fs.mkdir(runDir, { recursive: true });
  const triggerModel = participant.model || IMAGE_TRIGGER_DEFAULT;
  const image = await generateImage({ token, accountId, prompt, triggerModel, signal });
  const savedPath = await saveImagePng(image.base64, runDir, "image.png");
  await fs.writeFile(
    path.join(runDir, "result.json"),
    `${JSON.stringify({ runId, savedPath, triggerModel, backend: "gpt-image-2", revisedPrompt: image.revisedPrompt, responseId: image.responseId, participant: { id: participant.id, kind: participant.kind } }, null, 2)}\n`,
    "utf8",
  );
  await recordLatestRun(ctx.cwd, { runId, runDir, participant, kind: "image" });
  return { runId, runDir, savedPath, mimeType: "image/png", base64: image.base64, revisedPrompt: image.revisedPrompt };
}

function imageSummary(participant: any, r: { savedPath: string; revisedPrompt?: string }) {
  return [
    `# @${participant.id}`,
    "",
    "Generated an image with **gpt-image-2** (via your openai-codex login).",
    r.revisedPrompt ? `Revised prompt: ${r.revisedPrompt}` : undefined,
    `Saved: ${r.savedPath}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function runImageParticipant(participant: any, prompt: string, ctx: any, pi: ExtensionAPI, signal?: AbortSignal) {
  ctx.ui.notify(`Generating image with @${participant.id} (gpt-image-2)...`, "info");
  const r = await generateImageArtifact(ctx, participant, prompt, signal);
  pi.sendMessage({
    customType: EXT,
    content: [
      { type: "text", text: imageSummary(participant, r) },
      { type: "image", data: r.base64, mimeType: r.mimeType },
    ],
    display: true,
    details: { runId: r.runId, runDir: r.runDir, savedPath: r.savedPath, revisedPrompt: r.revisedPrompt, participant, prompt, kind: "image" },
  });
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
    "  /cf participants add --name <name> --kind <pi|claude-code|codex|opencode|image> --model <model> [--effort <e>] [--thinking <t>] [--roles <r>] [--tools <readonly|workspace-write|full-auto>] [--cwd <subdir>]",
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
  // Show the policy actually used at runtime: an advisory role saved with a write policy still runs
  // read-only (effectiveToolsPolicy), and the listing should reflect that, not the misleading config.
  const effective = effectiveToolsPolicy(p);
  const tools = effective === p.toolsPolicy ? `tools=${p.toolsPolicy}` : `tools=${effective} (advisory; configured ${p.toolsPolicy})`;
  const head = `- @${p.id} (${p.kind}${model}${effort}${cwd}${skills}${preset}) roles=${(p.roles ?? []).join(",") || "-"} ${tools}`;
  return p.description ? `${head}\n    ${p.description}` : head;
}

const CONSULT_REMINDER = "_Reminder: summarize this for the user with your recommendation, and get their approval before applying it (unless they already authorized you to proceed)._";

// The run output reports what context rode along: a silently-empty handoff looks identical to a
// full one from the participant's answer alone.
function summarizeHandoff(handoff: string, included: boolean) {
  if (!included) return "skipped (includeHandoff=false)";
  if (!String(handoff ?? "").trim()) return "empty — no session history to hand off";
  return `attached (${Math.max(1, Math.round(Buffer.byteLength(handoff, "utf8") / 1024))} KB)`;
}

function renderRunResult(result: any) {
  const writeCapable = effectiveToolsPolicy(result.participant) !== "readonly";
  const lines = [`# @${result.participant.id}`, "", `Run: ${result.runId}`, `Exit: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`, `Artifacts: ${result.runDir}`];
  if (result.handoffSummary) lines.push(`Handoff: ${result.handoffSummary}`);
  if (writeCapable) lines.push("", "> Write-capable run: this participant could edit files and run commands. Inspect what changed in the workspace (e.g. `git status` / `git diff` in a repo) and review it before keeping or building on it.");
  lines.push("", result.output);
  return lines.join("\n");
}

function sendCfMessage(pi: ExtensionAPI, content: string, details?: any) {
  pi.sendMessage({ customType: EXT, content, display: true, details });
}

// Single error surface for every entry path (the /cf router, the @mention input handler, and the
// per-participant /<name> commands) so a typo or a runner/login failure always gets the same
// polished message instead of throwing raw out of the input handler.
function reportCfError(pi: ExtensionAPI, ctx: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(`ConsensFlow error: ${message}`, "error");
  sendCfMessage(pi, `# ConsensFlow error\n\n${message}`, { error: message });
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
