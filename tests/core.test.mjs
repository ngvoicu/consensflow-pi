import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gitChangesDiffer } from "../extensions/consensflow/lib/artifacts.js";
import { createPacket } from "../extensions/consensflow/lib/packets.js";
import { getPreset, listPresetIds, participantFromPreset } from "../extensions/consensflow/lib/presets.js";
import { serializeTranscript } from "../extensions/consensflow/lib/handoff.js";
import { buildRunnerInvocation, codexSandbox, effectiveTimeoutMs, normalizeProcessOutput, runParticipant, spawnWithInput, toolsForPi } from "../extensions/consensflow/lib/runners.js";
import { getParticipant, loadParticipants, normalizeParticipant, removeParticipant, upsertParticipant } from "../extensions/consensflow/lib/state.js";
import { effectiveToolsPolicy, participantForKind } from "../extensions/consensflow/lib/workflows.js";
import { parseOptions, parseParticipantPrompt, slugify, tokenize } from "../extensions/consensflow/lib/utils.js";
import { buildImageRequestBody, decodeChatGptAccountId, extractImageFromEvents, saveImagePng } from "../extensions/consensflow/lib/image.js";

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
      handoff: "User:\nhi\n\nLead:\nworking on the packet",
      diff: { status: " M README.md", stat: "README.md | 2 +", patch: "diff --git a/README.md b/README.md" },
    });
    assert.match(packet, /## Message from the user/);
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
  assert.deepEqual(listPresetIds(), [
    "calliope", "clio", "euterpe", "thalia",
    "zeus", "apollo", "artemis", "athena", "perseus", "iris", "hermes", "eos", "luna",
    "orpheus", "linus", "erato", "saga", "gunnlod", "kvasir",
    "kronos", "atlas", "baldr", "vali", "forseti", "bragi", "ullr",
    "hermod", "loki", "nike", "freya", "zephyros", "sif",
    "hades", "helios", "ares", "hephaestus", "pan", "aeolus", "metis",
    "odin", "heimdall", "thor", "tyr", "vidar", "njord", "mimir",
    "pygmalion",
  ]);
  assert.equal(getPreset("zeus").kind, "claude-code");
  assert.equal(getPreset("athena").model, "gpt-5.5");
  assert.equal(getPreset("iris").thinking, "xhigh");
  assert.equal(getPreset("pygmalion").kind, "image");
  // The frontier matrix: same model+effort family on every engine that runs it.
  assert.equal(getPreset("artemis").effort, "medium");
  assert.equal(getPreset("perseus").effort, "high");
  assert.equal(getPreset("kronos").model, "anthropic/claude-opus-4-8");
  assert.equal(getPreset("baldr").model, "openrouter/anthropic/claude-opus-4.8");
  assert.equal(getPreset("forseti").model, "openrouter/openai/gpt-5.5");
  // Effort vocabularies are engine-real: "max" exists only on claude-code; OpenRouter tops out
  // at xhigh, and models without catalog variants (e.g. Kimi K2.6) carry no effort at all.
  assert.equal(getPreset("baldr").effort, "xhigh");
  assert.equal(getPreset("luna").effort, undefined);
  assert.equal(getPreset("heimdall").effort, "high");
  assert.equal(getPreset("sif").effort, "low");
  // Fable 5 family follows the same rules: claude-code gets max, the rest cap at xhigh.
  assert.equal(getPreset("calliope").effort, "max");
  assert.equal(getPreset("calliope").model, "claude-fable-5");
  assert.equal(getPreset("orpheus").model, "anthropic/claude-fable-5");
  assert.equal(getPreset("saga").model, "openrouter/anthropic/claude-fable-5");
  assert.equal(getPreset("saga").effort, "xhigh");
  assert.equal(getPreset("euterpe").effort, "high");
  assert.equal(getPreset("linus").thinking, "high");
  assert.equal(getPreset("gunnlod").effort, "high");
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

test("readonly enforcement reaches every engine: claude allow+deny lists, opencode permission env", () => {
  // Claude readonly: explorers allowed, write tools explicitly denied (a user-level Bash
  // allowlist must not leak write capability into a read-only reviewer).
  const claude = buildRunnerInvocation({ kind: "claude-code", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.ok(claude.args.includes("Read,Grep,Glob"));
  const denyIndex = claude.args.indexOf("--disallowedTools");
  assert.ok(denyIndex >= 0);
  assert.match(claude.args[denyIndex + 1], /Bash/);
  assert.match(claude.args[denyIndex + 1], /Edit/);
  assert.match(claude.args[denyIndex + 1], /Write/);
  const claudeWrite = buildRunnerInvocation({ kind: "claude-code", toolsPolicy: "workspace-write" }, "/tmp/packet.md", "/repo");
  assert.equal(claudeWrite.args.includes("--disallowedTools"), false);
  assert.ok(claudeWrite.args.some((arg) => arg.includes("Edit") && arg.includes("Bash")));

  // OpenCode defaults to edit/bash "allow"; readonly must override via OPENCODE_PERMISSION.
  const opencode = buildRunnerInvocation({ kind: "opencode", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.deepEqual(JSON.parse(opencode.env.OPENCODE_PERMISSION), { edit: "deny", bash: "deny" });
  const opencodeWrite = buildRunnerInvocation({ kind: "opencode", toolsPolicy: "workspace-write" }, "/tmp/packet.md", "/repo");
  assert.equal(opencodeWrite.env?.OPENCODE_PERMISSION, undefined);

  // Billing guard: participant runs ride the configured logins, not a stray env API key.
  assert.deepEqual(claude.dropEnv, ["ANTHROPIC_API_KEY"]);
  const codex = buildRunnerInvocation({ kind: "codex", toolsPolicy: "readonly" }, "/tmp/packet.md", "/repo");
  assert.deepEqual(codex.dropEnv, ["OPENAI_API_KEY"]);
});

test("spawnWithInput survives a child that exits without reading stdin (EPIPE)", async () => {
  // `true` exits immediately without consuming the 5MB packet; the stdin pipe raises EPIPE,
  // which must be captured, not thrown as an uncaughtException that kills the host.
  const result = await spawnWithInput("true", [], { input: "x".repeat(5 * 1024 * 1024), timeoutMs: 10_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
});

test("effectiveTimeoutMs: per-call override wins over participant config, then the default", () => {
  assert.equal(effectiveTimeoutMs({ timeoutMs: 900000 }, 1234), 1234);
  assert.equal(effectiveTimeoutMs({ timeoutMs: 900000 }, undefined), 900000);
  assert.equal(effectiveTimeoutMs({}, undefined), 10 * 60 * 1000);
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
  assert.equal(renamed.model, "claude-opus-4-8");
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
  assert.match(text, /User:\nfirst question/);
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
  assert.match(text, /User → @iris: which cache strategy\?/);
  assert.match(text, /@iris replied:\nUse a write-through cache\./);
  // The run-metadata noise from the rendered message is not used when structured details exist.
  assert.doesNotMatch(text, /Run: ask-123/);
});

test("serializeTranscript keeps cf_run_participant tool results near-whole (lead-initiated cross-pollination)", () => {
  const reply = "A".repeat(5000);
  const branch = [
    { type: "message", id: "1", message: { role: "toolResult", toolName: "cf_run_participant", content: [{ type: "text", text: reply }] } },
    { type: "message", id: "2", message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: reply }] } },
  ];
  const text = serializeTranscript(branch);
  // The consultation survives beyond the generic cap; ordinary tool results stay tightly truncated.
  assert.ok(text.includes(reply));
  assert.match(text, /Tool result read:\nA{1500}…\[truncated\]/);
});

test("parseParticipantPrompt routes one mention anywhere, and never hijacks stray @tokens", () => {
  const known = new Set(["zeus", "athena"]);
  // Leading and trailing single mention are equivalent (the headline fix).
  assert.deepEqual(parseParticipantPrompt(["@zeus", "hi"], known), { participant: "zeus", prompt: "hi" });
  assert.deepEqual(parseParticipantPrompt(["hi", "@zeus"], known), { participant: "zeus", prompt: "hi" });
  assert.deepEqual(parseParticipantPrompt(["summarize", "@zeus", "please"], known), { participant: "zeus", prompt: "summarize please" });
  // "ask"/"to" verb prefix still addresses a leading participant.
  assert.deepEqual(parseParticipantPrompt(["ask", "@athena", "review"], known), { participant: "athena", prompt: "review" });
  // A leading mention wins and later @names stay as quoted text (paste-prior-output intact).
  assert.deepEqual(parseParticipantPrompt(["@athena", "agree", "with", "@zeus?"], known), { participant: "athena", prompt: "agree with @zeus?" });
  // Multiple leading mentions are rejected.
  assert.ok(parseParticipantPrompt(["@zeus", "@athena", "hi"], known)?.error);
  // A stray non-leading @token that is not a participant goes to the lead, not a subprocess.
  assert.equal(parseParticipantPrompt(["install", "@types/node", "now"], known), null);
  // Two different participants, none leading -> ambiguous, lead handles.
  assert.equal(parseParticipantPrompt(["compare", "@zeus", "and", "@athena"], known), null);
  // No mention at all.
  assert.equal(parseParticipantPrompt(["just", "fix", "the", "bug"], known), null);
  // Leading mention without a prompt errors helpfully.
  assert.ok(parseParticipantPrompt(["@zeus"], known)?.error);
  // Without a known-set, a non-leading mention does not route (conservative default).
  assert.equal(parseParticipantPrompt(["hi", "@zeus"]), null);
});

test("image helpers: JWT account id, request body, SSE extraction, PNG save", async () => {
  // decodeChatGptAccountId pulls the claim out of the openai-codex JWT.
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_42" } })).toString("base64url");
  assert.equal(decodeChatGptAccountId(`h.${payload}.sig`), "acc_42");
  assert.throws(() => decodeChatGptAccountId("not-a-jwt"), /JWT/);

  // buildImageRequestBody triggers exactly one image_generation call with the prompt.
  const body = buildImageRequestBody("a red cat", "gpt-5.5");
  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.tools[0].type, "image_generation");
  assert.equal(body.input[0].content[0].text, "a red cat");

  // extractImageFromEvents finds the base64 image + metadata across SSE events.
  const img = extractImageFromEvents([
    { type: "response.created", response: { id: "r1" } },
    { type: "response.output_item.done", item: { type: "image_generation_call", id: "i1", status: "completed", result: "QkFTRTY0", revised_prompt: "a bright red cat" } },
    { type: "response.completed", response: { id: "r1" } },
  ]);
  assert.equal(img.base64, "QkFTRTY0");
  assert.equal(img.revisedPrompt, "a bright red cat");
  assert.equal(img.responseId, "r1");
  assert.throws(() => extractImageFromEvents([{ type: "error", message: "boom" }]), /boom/);

  // saveImagePng decodes base64 and writes the file.
  await withTempDir(async (cwd) => {
    const b64 = Buffer.from("PNGDATA").toString("base64");
    const saved = await saveImagePng(b64, path.join(cwd, "runs", "img1"), "image.png");
    assert.equal((await readFile(saved)).toString(), "PNGDATA");
  });
});

test("effectiveToolsPolicy coerces every advisory role to readonly; non-advisory/empty roles honor the policy", () => {
  assert.equal(effectiveToolsPolicy({ roles: ["reviewer"], toolsPolicy: "workspace-write" }), "readonly");
  assert.equal(effectiveToolsPolicy({ roles: ["council"], toolsPolicy: "workspace-write" }), "readonly");
  assert.equal(effectiveToolsPolicy({ roles: ["knowledge"], toolsPolicy: "full-auto" }), "readonly");
  // A mix that includes a non-advisory role is not purely advisory -> honors the configured policy.
  assert.equal(effectiveToolsPolicy({ roles: ["reviewer", "implementer"], toolsPolicy: "workspace-write" }), "workspace-write");
  // Fail safe: an empty (or missing) roles set grants no write capability, regardless of the configured policy.
  assert.equal(effectiveToolsPolicy({ roles: [], toolsPolicy: "workspace-write" }), "readonly");
  assert.equal(effectiveToolsPolicy({ roles: [], toolsPolicy: "readonly" }), "readonly");
  assert.equal(effectiveToolsPolicy({ toolsPolicy: "full-auto" }), "readonly");
});

test("normalizeParticipant rejects all-invalid roles so a misconfigured write policy cannot slip through", () => {
  // --roles bogus would filter to [] and bypass the advisory->readonly coercion, leaving it write-capable.
  assert.throws(
    () => normalizeParticipant({ name: "X", kind: "codex", roles: "bogus", toolsPolicy: "workspace-write" }),
    /roles must be one or more of/,
  );
  // Omitted roles fall back to the valid default (reviewer) and are coerced read-only.
  const p = normalizeParticipant({ name: "Y", kind: "codex", toolsPolicy: "workspace-write" });
  assert.deepEqual(p.roles, ["reviewer"]);
  assert.equal(effectiveToolsPolicy(p), "readonly");
  // A partially-valid roles list keeps the valid entries (does not throw).
  const q = normalizeParticipant({ name: "Z", kind: "codex", roles: "implementer,bogus", toolsPolicy: "workspace-write" });
  assert.deepEqual(q.roles, ["implementer"]);
  assert.equal(effectiveToolsPolicy(q), "workspace-write");
  // Whitespace/comma-only roles normalize to [] (no throw) but stay fail-safe: never write-capable.
  const empty = normalizeParticipant({ name: "E", kind: "codex", roles: " , ", toolsPolicy: "workspace-write" });
  assert.deepEqual(empty.roles, []);
  assert.equal(effectiveToolsPolicy(empty), "readonly");
});

test("parseParticipantPrompt: ask/to verb prefixes and the ask-noise boundary", () => {
  const known = new Set(["zeus", "athena"]);
  // The "to" verb addresses a leading participant.
  assert.deepEqual(parseParticipantPrompt(["to", "@zeus", "hi"], known), { participant: "zeus", prompt: "hi" });
  // A leading address routes even when the name is not in the known set (explicit address wins).
  assert.deepEqual(parseParticipantPrompt(["ask", "@ghost", "hi"], known), { participant: "ghost", prompt: "hi" });
  // "ask <english-verb> @types/..." is not an address: the @token is unknown -> stays with the lead.
  assert.equal(parseParticipantPrompt(["ask", "fix", "@types/node", "please"], known), null);
});

test("the cf_run_participant consent gate and name-neutrality stay locked in the extension source", async () => {
  const src = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  // The consent gate must stay in the tool description + promptSnippet (its load-bearing home).
  assert.match(src, /do NOT apply/);
  assert.match(src, /without first showing the user/);
  assert.match(src, /no user permission needed/);
  // The personal name must not reappear anywhere in the extension.
  assert.doesNotMatch(src, /Gabriel/);
  // No hidden-workflow commands should be registered (council/knowledge are legit roles, so match the command form only).
  assert.doesNotMatch(src, /registerCommand\("(grill|spec-review|council|handoff)"/);
});

test("every lib symbol the extension imports is actually exported (boundary smoke)", async () => {
  const src = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"(\.\/extensions\/consensflow\/lib\/[^"]+)"/g;
  let match;
  let checked = 0;
  while ((match = importRe.exec(src))) {
    const symbols = match[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const loaded = await import(match[2].replace("./extensions/", "../extensions/"));
    for (const symbol of symbols) {
      assert.notEqual(loaded[symbol], undefined, `${match[2]} must export ${symbol}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 10, `expected to verify several lib imports, got ${checked}`);
});

test("image path safety: runner backstop throws and extractImageFromEvents handles failure/empty", () => {
  // The runner must never spawn a CLI for an image participant.
  assert.throws(() => buildRunnerInvocation({ kind: "image", model: "gpt-5.5" }, "/tmp/packet.md", "/tmp"), /image participants are generated/);
  // response.failed surfaces the error message.
  assert.throws(() => extractImageFromEvents([{ type: "response.failed", response: { error: { message: "content blocked" } } }]), /content blocked/);
  // A text-only / empty stream yields no image rather than a bogus base64.
  assert.equal(extractImageFromEvents([{ type: "response.output_text.delta", delta: "hi" }]).base64, undefined);
  assert.equal(extractImageFromEvents([]).base64, undefined);
});

test("gitChangesDiffer detects untracked + staged + re-edit changes a plain `git diff` would miss", () => {
  const base = { status: "", patch: "", stat: "", cached: "" };
  // Identical snapshots -> no change.
  assert.equal(gitChangesDiffer(base, { ...base }), false);
  // A new (untracked) file: git diff/stat stay empty; only `git status --short` shows it.
  assert.equal(gitChangesDiffer(base, { ...base, status: "?? new.js" }), true);
  // A staged edit: unstaged patch empty, cached holds the diff.
  assert.equal(gitChangesDiffer(base, { ...base, status: "M  a.js", cached: "diff --git a/a.js b/a.js" }), true);
  // Re-editing an already-dirty file: status line is identical, but the patch content grows.
  const before = { status: " M a.js", patch: "@@ -1 +1 @@\n-x\n+y", stat: " a.js | 2 +-", cached: "" };
  const after = { status: " M a.js", patch: "@@ -1 +2 @@\n-x\n+y\n+z", stat: " a.js | 3 +-", cached: "" };
  assert.equal(gitChangesDiffer(before, after), true);
  // Missing snapshots: no `after` -> cannot tell (false); no `before` -> assume changed (true).
  assert.equal(gitChangesDiffer(before, null), false);
  assert.equal(gitChangesDiffer(null, after), true);
});
