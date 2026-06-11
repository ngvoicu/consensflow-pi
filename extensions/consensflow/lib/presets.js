import { slugify, stripMention } from "./utils.js";

const T = 900000;

export const PARTICIPANT_PRESETS = [
  // --- House team: a strong read-only reviewer per engine -----------------
  {
    preset: "zeus",
    id: "zeus",
    name: "Zeus",
    label: "Claude Code Opus 4.8 MAX",
    description: "Most expensive/deep Claude Code reviewer for high-stakes architecture and final review.",
    kind: "claude-code",
    model: "claude-opus-4-8",
    effort: "max",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "apollo",
    id: "apollo",
    name: "Apollo",
    label: "Claude Code Opus 4.8 XHIGH",
    description: "Deep but slightly cheaper/faster Claude Code reviewer for spec critique and design alternatives.",
    kind: "claude-code",
    model: "claude-opus-4-8",
    effort: "xhigh",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
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
    timeoutMs: T,
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
    timeoutMs: T,
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
    timeoutMs: T,
  },

  // --- Fast/cheap tier: quick gut-checks ----------------------------------
  {
    preset: "hermod",
    id: "hermod",
    name: "Hermod",
    label: "Claude Code Haiku 4.5 (fast)",
    description: "Fast, cheap Claude Code reviewer (Haiku) for quick gut-checks.",
    kind: "claude-code",
    model: "claude-haiku-4-5",
    effort: "low",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "loki",
    id: "loki",
    name: "Loki",
    label: "Codex GPT 5.5 (fast/medium)",
    description: "Nimbler Codex reviewer: GPT 5.5 at medium effort for quicker turnarounds.",
    kind: "codex",
    model: "gpt-5.5",
    effort: "medium",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "nike",
    id: "nike",
    name: "Nike",
    label: "Pi Gemini 3.5 Flash (fast)",
    description: "Swift, cheap Pi-backed Gemini 3.5 Flash for quick second opinions.",
    kind: "pi",
    model: "openrouter/google/gemini-3.5-flash",
    thinking: "low",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "freya",
    id: "freya",
    name: "Freya",
    label: "OpenCode DeepSeek V4 Flash (fast)",
    description: "Cheap, fast OpenCode-backed DeepSeek V4 Flash (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/deepseek/deepseek-v4-flash",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },

  // --- pi model zoo (Greek names) — popular OpenRouter models via Pi -------
  {
    preset: "hades",
    id: "hades",
    name: "Hades",
    label: "Pi DeepSeek V4 Pro",
    description: "Pi-backed DeepSeek V4 Pro reviewer (via OpenRouter).",
    kind: "pi",
    model: "openrouter/deepseek/deepseek-v4-pro",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "helios",
    id: "helios",
    name: "Helios",
    label: "Pi Gemini 3.1 Pro",
    description: "Pi-backed Google Gemini 3.1 Pro reviewer (via OpenRouter).",
    kind: "pi",
    model: "openrouter/google/gemini-3.1-pro-preview",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "ares",
    id: "ares",
    name: "Ares",
    label: "Pi Grok 4.3",
    description: "Pi-backed xAI Grok 4.3 reviewer (via OpenRouter).",
    kind: "pi",
    model: "openrouter/x-ai/grok-4.3",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "hephaestus",
    id: "hephaestus",
    name: "Hephaestus",
    label: "Pi Qwen3.7 Max",
    description: "Pi-backed Qwen3.7 Max reviewer (via OpenRouter).",
    kind: "pi",
    model: "openrouter/qwen/qwen3.7-max",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "pan",
    id: "pan",
    name: "Pan",
    label: "Pi Llama 4 Maverick",
    description: "Pi-backed Meta Llama 4 Maverick reviewer (via OpenRouter).",
    kind: "pi",
    model: "openrouter/meta-llama/llama-4-maverick",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "aeolus",
    id: "aeolus",
    name: "Aeolus",
    label: "Pi Mistral Large",
    description: "Pi-backed Mistral Large reviewer (via OpenRouter); wind god for 'mistral'.",
    kind: "pi",
    model: "openrouter/mistralai/mistral-large-2512",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "metis",
    id: "metis",
    name: "Metis",
    label: "Pi MiniMax M3",
    description: "Pi-backed MiniMax M3 reviewer (via OpenRouter); goddess of cunning strategy for 'minimax'.",
    kind: "pi",
    model: "openrouter/minimax/minimax-m3",
    thinking: "high",
    skillsPolicy: "default",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },

  // --- opencode model zoo (Norse names) — same models via OpenCode --------
  {
    preset: "odin",
    id: "odin",
    name: "Odin",
    label: "OpenCode DeepSeek V4 Pro",
    description: "OpenCode-backed DeepSeek V4 Pro reviewer (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/deepseek/deepseek-v4-pro",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "heimdall",
    id: "heimdall",
    name: "Heimdall",
    label: "OpenCode Gemini 3.1 Pro",
    description: "OpenCode-backed Google Gemini 3.1 Pro reviewer (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/google/gemini-3.1-pro-preview",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "thor",
    id: "thor",
    name: "Thor",
    label: "OpenCode Grok 4.3",
    description: "OpenCode-backed xAI Grok 4.3 reviewer (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/x-ai/grok-4.3",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "tyr",
    id: "tyr",
    name: "Tyr",
    label: "OpenCode Qwen3.7 Max",
    description: "OpenCode-backed Qwen3.7 Max reviewer (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/qwen/qwen3.7-max",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "vidar",
    id: "vidar",
    name: "Vidar",
    label: "OpenCode Llama 4 Maverick",
    description: "OpenCode-backed Meta Llama 4 Maverick reviewer (via OpenRouter).",
    kind: "opencode",
    model: "openrouter/meta-llama/llama-4-maverick",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "njord",
    id: "njord",
    name: "Njord",
    label: "OpenCode Mistral Large",
    description: "OpenCode-backed Mistral Large reviewer (via OpenRouter); sea/wind god for 'mistral'.",
    kind: "opencode",
    model: "openrouter/mistralai/mistral-large-2512",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },
  {
    preset: "mimir",
    id: "mimir",
    name: "Mimir",
    label: "OpenCode MiniMax M3",
    description: "OpenCode-backed MiniMax M3 reviewer (via OpenRouter); god of wisdom for 'minimax'.",
    kind: "opencode",
    model: "openrouter/minimax/minimax-m3",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
  },

  // --- Image generation (Codex backend → gpt-image-2) ---------------------
  {
    preset: "pygmalion",
    id: "pygmalion",
    name: "Pygmalion",
    label: "Image — gpt-image-2 (via Codex login)",
    description: "Generates images with gpt-image-2 through your existing openai-codex login. The model field is only the trigger model; the image backend is always gpt-image-2.",
    kind: "image",
    model: "gpt-5.5",
    roles: ["reviewer"],
    toolsPolicy: "readonly",
    timeoutMs: T,
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
  return ["# ConsensFlow participant presets", "", ...PARTICIPANT_PRESETS.map(formatPresetLine), "", "Add one with `/cf participants add <preset>`, or `/cf participants add all`."].join("\n");
}
