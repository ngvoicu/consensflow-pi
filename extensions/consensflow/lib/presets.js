import { slugify, stripMention } from "./utils.js";

export const PARTICIPANT_PRESETS = [
  {
    preset: "zeus",
    id: "zeus",
    name: "Zeus",
    label: "Claude Code Opus 4.7 MAX",
    description: "Most expensive/deep Claude Code reviewer for high-stakes architecture and final review.",
    kind: "claude-code",
    model: "claude-opus-4-7",
    effort: "max",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: 900000,
  },
  {
    preset: "apollo",
    id: "apollo",
    name: "Apollo",
    label: "Claude Code Opus 4.7 XHIGH",
    description: "Deep but slightly cheaper/faster Claude Code reviewer for spec critique and design alternatives.",
    kind: "claude-code",
    model: "claude-opus-4-7",
    effort: "xhigh",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: 900000,
  },
  {
    preset: "athena",
    id: "athena",
    name: "Athena",
    label: "Codex GPT 5.5 XHIGH",
    description: "Codex reviewer/planner with GPT 5.5 and xhigh reasoning effort.",
    kind: "codex",
    model: "gpt-5.5",
    effort: "xhigh",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: 900000,
  },
  {
    preset: "iris",
    id: "iris",
    name: "Iris",
    label: "Pi GPT 5.5 XHIGH",
    description: "Pi-backed GPT 5.5 participant with xhigh thinking and normal Pi skills available.",
    kind: "pi",
    model: "openai-codex/gpt-5.5",
    thinking: "xhigh",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: 900000,
  },
  {
    preset: "luna",
    id: "luna",
    name: "Luna",
    label: "OpenCode Kimi K2.6 MAX",
    description: "OpenCode-backed Kimi K2.6 participant at highest available effort/variant.",
    kind: "opencode",
    model: "openrouter/moonshotai/kimi-k2.6",
    effort: "max",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: 900000,
  },
];

export function getPreset(ref) {
  const id = slugify(stripMention(ref));
  return PARTICIPANT_PRESETS.find((preset) => preset.preset === id || preset.id === id || slugify(preset.name) === id) ?? null;
}

export function listPresetIds() {
  return PARTICIPANT_PRESETS.map((preset) => preset.preset);
}

export function participantFromPreset(ref, overrides = {}) {
  const preset = getPreset(ref);
  if (!preset) return null;
  const nameOverride = stringOverride(overrides.name);
  const idOverride = stringOverride(overrides.id);
  const name = nameOverride ?? preset.name;
  // Keep the preset's canonical id; only derive a new id when the caller renames (--name) or sets
  // an explicit id.
  const id = slugify(idOverride ?? nameOverride ?? preset.id);
  const participant = {
    ...preset,
    ...allowedOverrides(overrides),
    preset: preset.preset,
    id,
    name,
    kind: preset.kind,
    model: preset.model,
    effort: preset.effort,
    thinking: preset.thinking,
    roles: preset.roles,
    toolsPolicy: preset.toolsPolicy,
    skillsPolicy: preset.skillsPolicy,
  };
  delete participant.label;
  return participant;
}

function stringOverride(value) {
  if (value === undefined || value === null || value === true) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function allowedOverrides(overrides) {
  const result = {};
  for (const key of ["cwd", "timeoutMs", "description"]) {
    if (overrides[key] !== undefined) result[key] = overrides[key];
  }
  return result;
}

export function formatPresetLine(preset) {
  const effort = preset.effort ? ` effort=${preset.effort}` : preset.thinking ? ` thinking=${preset.thinking}` : "";
  const skills = preset.kind === "pi" ? ` skills=${preset.skillsPolicy ?? "default"}` : "";
  return `- ${preset.preset} → @${preset.id} (${preset.name}): ${preset.label} [${preset.kind} model=${preset.model}${effort}${skills}]`;
}

export function formatPresets() {
  return ["# ConsensFlow participant presets", "", ...PARTICIPANT_PRESETS.map(formatPresetLine), "", "Add one:", "", "```text", "/cf participants add zeus", "/cf participants add apollo", "/cf participants add athena", "/cf participants add iris", "/cf participants add luna", "```"].join("\n");
}
