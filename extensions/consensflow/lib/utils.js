import crypto from "node:crypto";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "participant";
}

export function createId(prefix = "run", date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${stamp}-${rand}`;
}

export function stripMention(value) {
  return String(value ?? "").replace(/^@+/, "");
}

export function displayMention(participant) {
  return `@${participant.id}`;
}

export function tokenize(input) {
  const text = String(input ?? "");
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const ch of text) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += "\\";
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function parseOptions(tokens) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--") || token === "--") {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) {
      flags[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[raw] = next;
      i += 1;
    } else {
      flags[raw] = true;
    }
  }
  return { positional, flags };
}

export function splitCsv(value, fallback = []) {
  if (value === undefined || value === null || value === true) return fallback;
  const items = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export function boolFlag(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function resolveInside(cwd, requested) {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, requested || ".");
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${requested}`);
  }
  return resolved;
}

export function truncateText(text, maxBytes = 128 * 1024) {
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return { text: value, truncated: false, bytes };
  let sliced = value.slice(0, maxBytes);
  while (Buffer.byteLength(sliced, "utf8") > maxBytes) sliced = sliced.slice(0, -1);
  return {
    text: `${sliced}\n\n[truncated: ${bytes - Buffer.byteLength(sliced, "utf8")} bytes omitted]`,
    truncated: true,
    bytes,
  };
}

export function extractMentions(tokens) {
  return tokens.filter((token) => token.startsWith("@")).map((token) => stripMention(token));
}

export function withoutMentions(tokens) {
  return tokens.filter((token) => !token.startsWith("@"));
}
