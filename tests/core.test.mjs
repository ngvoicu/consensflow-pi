import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPacket } from "../extensions/consensflow/lib/packets.js";
import { getPreset, listPresetIds, participantFromPreset } from "../extensions/consensflow/lib/presets.js";
import { serializeTranscript } from "../extensions/consensflow/lib/handoff.js";
import { buildRunnerInvocation, codexSandbox, toolsForPi, normalizeProcessOutput, runParticipant } from "../extensions/consensflow/lib/runners.js";
import { getParticipant, loadParticipants, removeParticipant, upsertParticipant } from "../extensions/consensflow/lib/state.js";
import { effectiveToolsPolicy, participantForKind } from "../extensions/consensflow/lib/workflows.js";
import { parseOptions, slugify, tokenize } from "../extensions/consensflow/lib/utils.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cf-pi-test-"));
  const oldHome = process.env.CONSENSFLOW_HOME;
  process.env.CONSENSFLOW_HOME = path.join(dir, "home", ".consensflow");
  try {
    return await fn(dir);
  } finally {
    if (oldHome === undefined) delete process.env.CONSENSFLOW_HOME;
    else process.env.CONSENSFLOW_HOME = oldHome;
    await rm(dir, { recursive: true, force: true });
  }
}

test("tokenize handles quotes and parseOptions handles flags", () => {
  assert.deepEqual(tokenize('add "Zeus Opus" --kind claude-code --model claude-opus-4-7'), [
    "add",
    "Zeus Opus",
    "--kind",
    "claude-code",
    "--model",
    "claude-opus-4-7",
  ]);
  assert.deepEqual(parseOptions(["Athena", "--kind=codex", "--model", "gpt-5.5"]).flags, {
    kind: "codex",
    model: "gpt-5.5",
  });
});

test("slugify creates stable mentions", () => {
  assert.equal(slugify("Zeus Opus 4.7"), "zeus-opus-4-7");
  assert.equal(slugify(" Isis  "), "isis");
});

test("participant CRUD persists global user-level JSON", async () => {
  await withTempDir(async (cwd) => {
    const athena = await upsertParticipant(cwd, {
      name: "Athena",
      kind: "codex",
      model: "gpt-5.5",
      effort: "xhigh",
      roles: ["implementer", "reviewer"],
      toolsPolicy: "workspace-write",
    });
    assert.equal(athena.id, "athena");
    assert.equal((await getParticipant(cwd, "@athena")).model, "gpt-5.5");
    assert.equal((await loadParticipants(cwd)).length, 1);
    assert.equal(await removeParticipant(cwd, "athena"), true);
    assert.equal((await loadParticipants(cwd)).length, 0);
  });
});

test("createPacket is conversational, mode-aware, and carries handoff + diff", async () => {
  await withTempDir(async (cwd) => {
    const participant = await upsertParticipant(cwd, {
      name: "Zeus",
      kind: "pi",
      model: "openrouter/anthropic/claude-opus-4.7",
      toolsPolicy: "readonly",
      roles: ["reviewer"],
    });
    const packet = await createPacket({
      cwd,
      participant,
      kind: "ask",
      task: "Review the latest changes",
      handoff: "Gabriel:\nhi\n\nLead:\nworking on the packet",
      diff: { status: " M README.md", stat: "README.md | 2 +", patch: "diff --git a/README.md b/README.md" },
    });
    assert.match(packet, /## Message from Gabriel/);
    assert.match(packet, /Review the latest changes/);
    assert.match(packet, /Read-only: you can inspect the workspace/);
    assert.match(packet, /## Handoff — current session/);
    assert.match(packet, /working on the packet/);
    assert.match(packet, /Latest workspace changes/);
    // The rigid reviewer template is gone.
    assert.doesNotMatch(packet, /Required output format/);
    assert.doesNotMatch(packet, /1\. Direct answer/);
    assert.doesNotMatch(packet, /Do not edit, write, or mutate files/);
  });
});

test("createPacket gives write-capable participants a read-write mode line", async () => {
  await withTempDir(async (cwd) => {
    const participant = await upsertParticipant(cwd, {
      name: "Builder",
      kind: "claude-code",
      toolsPolicy: "workspace-write",
      roles: ["implementer"],
    });
    const packet = await createPacket({ cwd, participant, kind: "ask", task: "add a health check endpoint" });
    assert.match(packet, /Read-write: you can read and modify this workspace/);
    assert.doesNotMatch(packet, /Read-only:/);
  });
});

test("participant presets expose the allowed creation list", () => {
  assert.deepEqual(listPresetIds(), ["zeus", "apollo", "athena", "iris", "luna"]);
  assert.equal(getPreset("zeus").kind, "claude-code");
  assert.equal(getPreset("athena").model, "gpt-5.5");
  assert.equal(getPreset("iris").thinking, "xhigh");
  const luna = participantFromPreset("luna", { cwd: "frontend", timeoutMs: 1234 });
  assert.equal(luna.id, "luna");
  assert.equal(luna.name, "Luna");
  assert.equal(luna.cwd, "frontend");
  assert.equal(luna.timeoutMs, 1234);
  assert.equal(participantFromPreset("custom"), null);
});

test("runner invocation maps tool policies", () => {
  assert.equal(toolsForPi("readonly"), "read,grep,find,ls");
  assert.equal(codexSandbox("workspace-write"), "workspace-write");
  const pi = buildRunnerInvocation({ kind: "pi", model: "openrouter/moonshotai/kimi-k2.6", toolsPolicy: "readonly", skillsPolicy: "default" }, "/tmp/packet.md", "/repo");
  assert.equal(pi.command, "pi");
  assert.deepEqual(pi.args.slice(0, 6), ["--mode", "json", "--no-session", "--no-extensions", "--model", "openrouter/moonshotai/kimi-k2.6"]);
  assert.ok(pi.args.includes("off"));
  assert.equal(pi.args.includes("--no-skills"), false);
  const sterilePi = buildRunnerInvocation({ kind: "pi", toolsPolicy: "readonly", skillsPolicy: "none" }, "/tmp/packet.md", "/repo");
  assert.ok(sterilePi.args.includes("--no-skills"));
  const codex = buildRunnerInvocation({ kind: "codex", model: "gpt-5.5", effort: "xhigh", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.equal(codex.command, "codex");
  assert.ok(codex.args.includes("read-only"));
  assert.ok(codex.args.includes("--ephemeral"));
  assert.ok(codex.args.includes("--skip-git-repo-check"));
  assert.ok(codex.args.includes("--ignore-user-config"));
  assert.ok(codex.args.includes("--ignore-rules"));
  assert.ok(codex.args.includes("model_reasoning_effort=\"xhigh\""));
});

test("advisory roles are forced read-only; configured tools are honored otherwise", () => {
  // Purely-advisory participant: a write policy is coerced away (the safety guard).
  const reviewer = { id: "athena", name: "Athena", kind: "codex", toolsPolicy: "workspace-write", roles: ["reviewer"] };
  assert.equal(effectiveToolsPolicy(reviewer), "readonly");
  assert.equal(participantForKind(reviewer, "ask").toolsPolicy, "readonly");

  // Implementer: the configured write policy IS honored. This is the headline "act if configured"
  // behavior — the reviewer case above would stay green without it, so this is the real check.
  const builder = { id: "builder", name: "Builder", kind: "claude-code", toolsPolicy: "workspace-write", roles: ["implementer"] };
  assert.equal(effectiveToolsPolicy(builder), "workspace-write");
  assert.equal(participantForKind(builder, "ask").toolsPolicy, "workspace-write");

  // A mixed role set that includes a non-advisory role keeps its full-auto policy.
  const lead = { id: "lead", name: "Lead", kind: "claude-code", toolsPolicy: "full-auto", roles: ["implementer", "reviewer"] };
  assert.equal(effectiveToolsPolicy(lead), "full-auto");

  // Explicit readonly stays readonly regardless of role.
  const ro = { id: "ro", name: "RO", kind: "pi", toolsPolicy: "readonly", roles: ["implementer"] };
  assert.equal(effectiveToolsPolicy(ro), "readonly");
});

test("runParticipant rejects participant cwd that escapes workspace before spawning", async () => {
  await withTempDir(async (cwd) => {
    await assert.rejects(
      runParticipant({
        cwd,
        participant: { id: "bad", name: "Bad", kind: "pi", roles: ["reviewer"], toolsPolicy: "readonly", cwd: "../outside" },
        packet: "# Packet",
        kind: "ask",
      }),
      /Path escapes workspace/,
    );
  });
});

test("normalizeProcessOutput parses Claude JSON result", () => {
  const out = normalizeProcessOutput("claude-code", JSON.stringify({ type: "result", result: "OK" }), "");
  assert.equal(out.output, "OK");
});

test("normalizeProcessOutput parses Claude JSON event array result", () => {
  const out = normalizeProcessOutput("claude-code", JSON.stringify([
    { type: "system" },
    { type: "assistant", message: { content: [{ type: "text", text: "draft" }] } },
    { type: "result", result: "CLAUDE FINAL" },
  ]), "");
  assert.equal(out.output, "CLAUDE FINAL");
});

test("normalizeProcessOutput parses Codex JSONL agent message text", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "t" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "draft" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "CODEX FINAL" } }),
  ].join("\n");
  const out = normalizeProcessOutput("codex", stdout, "");
  assert.equal(out.output, "CODEX FINAL");
});

test("normalizeProcessOutput parses Pi JSON mode final assistant text", () => {
  const stdout = [
    JSON.stringify({ type: "session", id: "s" }),
    JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "PI OK" }] } }),
    JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "PI FINAL" }] }] }),
  ].join("\n");
  const out = normalizeProcessOutput("pi", stdout, "");
  assert.equal(out.output, "PI FINAL");
});

test("normalizeProcessOutput parses Pi JSON mode from a truncated tail", () => {
  const stdout = [
    "[truncated: kept tail]",
    JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ignored" } }),
    JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "TAIL FINAL" }] }] }),
  ].join("\n");
  const out = normalizeProcessOutput("pi", stdout, "");
  assert.equal(out.output, "TAIL FINAL");
});

test("participantFromPreset can rename while keeping the backend", () => {
  const renamed = participantFromPreset("zeus", { name: "Deepreview" });
  assert.equal(renamed.id, "deepreview");
  assert.equal(renamed.name, "Deepreview");
  assert.equal(renamed.kind, "claude-code");
  assert.equal(renamed.model, "claude-opus-4-7");
  assert.equal(renamed.preset, "zeus");
  // Without a rename, the canonical preset id and name are kept.
  const luna = participantFromPreset("luna");
  assert.equal(luna.id, "luna");
  assert.equal(luna.name, "Luna");
});

test("serializeTranscript preserves chronological (root->leaf) order with role labels and tool calls", () => {
  // getBranch() returns entries root -> leaf (oldest first); serialization keeps that order.
  const branch = [
    { type: "message", id: "0", message: { role: "user", content: "first question" } },
    { type: "message", id: "1", message: { role: "assistant", content: [{ type: "text", text: "First reply" }] } },
    { type: "message", id: "2", message: { role: "user", content: "second question" } },
    { type: "message", id: "3", message: { role: "assistant", content: [{ type: "text", text: "Second reply" }, { type: "toolCall", name: "read", arguments: { path: "a.ts" } }] } },
  ];
  const text = serializeTranscript(branch, { maxBytes: 10000 });
  assert.match(text, /Gabriel:\nfirst question/);
  assert.match(text, /Lead:\nFirst reply/);
  assert.match(text, /→ read\(/);
  assert.ok(text.indexOf("first question") < text.indexOf("second question"), "chronological order");
});

test("serializeTranscript honors the latest compaction summary", () => {
  // root -> leaf order: the dropped message precedes the compaction, kept messages follow it.
  const branch = [
    { type: "message", id: "old", message: { role: "user", content: "ancient dropped question" } },
    { type: "compaction", id: "c1", summary: "the earlier stuff", firstKeptEntryId: "k1" },
    { type: "message", id: "k1", message: { role: "user", content: "kept question" } },
    { type: "message", id: "k2", message: { role: "assistant", content: [{ type: "text", text: "after compaction reply" }] } },
  ];
  const text = serializeTranscript(branch);
  assert.match(text, /\[Earlier conversation summary\]\nthe earlier stuff/);
  assert.match(text, /kept question/);
  assert.doesNotMatch(text, /ancient dropped question/);
});

test("serializeTranscript caps bytes keeping the tail, and handles empty input", () => {
  const long = Array.from({ length: 50 }, (_, i) => ({ type: "message", id: String(i), message: { role: "user", content: "x".repeat(500) } }));
  const text = serializeTranscript(long, { maxBytes: 2000 });
  assert.ok(Buffer.byteLength(text, "utf8") <= 2000);
  assert.match(text, /\[earlier handoff truncated\]/);
  assert.equal(serializeTranscript([]), "");
  assert.equal(serializeTranscript(null), "");
});

test("serializeTranscript surfaces prior ConsensFlow participant exchanges (cross-pollination)", () => {
  const branch = [
    { type: "message", id: "0", message: { role: "user", content: "let's design the cache" } },
    {
      type: "custom_message",
      id: "1",
      customType: "consensflow",
      content: "# @iris\n\nRun: ask-123\nExit: 0\n\nUse a write-through cache.",
      details: { participant: { id: "iris" }, prompt: "which cache strategy?", output: "Use a write-through cache." },
    },
  ];
  const text = serializeTranscript(branch);
  assert.match(text, /Gabriel → @iris: which cache strategy\?/);
  assert.match(text, /@iris replied:\nUse a write-through cache\./);
  // The run-metadata noise from the rendered message is not used when structured details exist.
  assert.doesNotMatch(text, /Run: ask-123/);
});
