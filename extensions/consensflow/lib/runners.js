import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createId, nowIso, resolveInside, truncateText } from "./utils.js";
import { ensureCfDirs, recordLatestRun, runsRoot } from "./state.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export function toolsForPi(policy) {
  if (policy === "readonly") return "read,grep,find,ls";
  return "read,grep,find,ls,bash,edit,write";
}

export function claudeAllowedTools(policy) {
  if (policy === "readonly") return "Read";
  return "Read,Edit,Write,Bash";
}

export function codexSandbox(policy) {
  if (policy === "readonly") return "read-only";
  if (policy === "workspace-write") return "workspace-write";
  return "danger-full-access";
}

export function buildRunnerInvocation(participant, packetPath, cwd) {
  const p = participant;
  switch (p.kind) {
    case "pi": {
      const args = ["--mode", "json", "--no-session", "--no-extensions"];
      if (p.skillsPolicy === "none" || p.skillsPolicy === "explicit") args.push("--no-skills");
      if (p.skillsPolicy === "explicit") {
        for (const skillPath of p.skillPaths ?? []) args.push("--skill", skillPath);
      }
      if (p.model) args.push("--model", p.model);
      args.push("--thinking", p.thinking ?? "off");
      args.push("--tools", toolsForPi(p.toolsPolicy), "-p", "Follow the ConsensFlow packet provided on stdin. Return only the requested output.");
      return { command: "pi", args, stdinMode: "packet", cwd };
    }
    case "claude-code": {
      const args = ["-p", "Follow the ConsensFlow packet provided on stdin. Return only the requested output.", "--output-format", "json", "--no-session-persistence", "--allowedTools", claudeAllowedTools(p.toolsPolicy)];
      if (p.model) args.push("--model", p.model);
      if (p.effort) args.push("--effort", p.effort);
      if (p.maxTurns) args.push("--max-turns", String(p.maxTurns));
      if (p.toolsPolicy === "full-auto") args.push("--dangerously-skip-permissions");
      return { command: "claude", args, stdinMode: "packet", cwd };
    }
    case "codex": {
      const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", codexSandbox(p.toolsPolicy), "-C", cwd];
      if (p.model) args.push("--model", p.model);
      if (p.effort) args.push("-c", `model_reasoning_effort=\"${p.effort}\"`);
      if (p.toolsPolicy === "full-auto") args.push("--dangerously-bypass-approvals-and-sandbox");
      args.push("-");
      return { command: "codex", args, stdinMode: "packet", cwd };
    }
    case "opencode": {
      const args = ["run", "--format", "json", "--dir", cwd, "--file", packetPath];
      if (p.model) args.push("--model", p.model);
      if (p.effort) args.push("--variant", p.effort);
      if (p.agent) args.push("--agent", p.agent);
      if (p.toolsPolicy === "full-auto") args.push("--dangerously-skip-permissions");
      args.push("Follow the ConsensFlow packet attached as a file. Return only the requested output.");
      return { command: "opencode", args, stdinMode: "none", cwd };
    }
    default:
      throw new Error(`Unsupported participant kind: ${p.kind}`);
  }
}

export async function runParticipant(input) {
  const { cwd, participant, packet, kind = "ask", signal } = input;
  await ensureCfDirs(cwd);
  const runId = input.runId ?? createId(kind);
  const runDir = path.join(runsRoot(cwd), runId);
  await fs.mkdir(runDir, { recursive: true });
  const packetPath = path.join(runDir, "packet.md");
  await fs.writeFile(packetPath, packet, "utf8");

  const invocationCwd = participant.cwd ? resolveInside(cwd, participant.cwd) : path.resolve(cwd);
  const invocation = buildRunnerInvocation(participant, packetPath, invocationCwd);
  const startedAt = nowIso();
  const procResult = await spawnWithInput(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    input: invocation.stdinMode === "packet" ? packet : undefined,
    signal,
    timeoutMs: Number(participant.timeoutMs) || input.timeoutMs || DEFAULT_TIMEOUT_MS,
  });
  const endedAt = nowIso();

  await fs.writeFile(path.join(runDir, "stdout.txt"), procResult.stdout, "utf8");
  await fs.writeFile(path.join(runDir, "stderr.txt"), procResult.stderr, "utf8");
  const normalized = normalizeProcessOutput(participant.kind, procResult.stdout, procResult.stderr);
  const result = {
    schemaVersion: 1,
    runId,
    runDir,
    packetPath,
    kind,
    participant,
    invocation: { command: invocation.command, args: invocation.args, cwd: invocation.cwd },
    startedAt,
    endedAt,
    exitCode: procResult.exitCode,
    timedOut: procResult.timedOut,
    signal: procResult.signal,
    output: normalized.output,
    rawOutputTruncated: procResult.truncated,
    stderr: truncateText(procResult.stderr, 64 * 1024).text,
  };
  await fs.writeFile(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await recordLatestRun(cwd, result);
  return result;
}

export async function spawnWithInput(command, args, options = {}) {
  const { cwd = process.cwd(), input, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let timedOut = false;
    let timeout;

    const append = (target, chunk) => {
      const text = chunk.toString();
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (Buffer.byteLength(stdout, "utf8") > MAX_CAPTURE_BYTES) {
        stdout = truncateTail(stdout, MAX_CAPTURE_BYTES).text;
        truncated = true;
      }
      if (Buffer.byteLength(stderr, "utf8") > MAX_CAPTURE_BYTES) {
        stderr = truncateTail(stderr, MAX_CAPTURE_BYTES).text;
        truncated = true;
      }
    };

    const finish = (exitCode, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abortHandler);
      resolve({ stdout, stderr, exitCode, signal: sig, timedOut, truncated });
    };

    const forceKillIfAlive = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };

    const abortHandler = () => {
      child.kill("SIGTERM");
      setTimeout(forceKillIfAlive, 3000).unref?.();
    };

    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(forceKillIfAlive, 3000).unref?.();
    }, timeoutMs);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      stderr += `\n[spawn error] ${error.message}`;
      finish(127, null);
    });
    child.on("close", (code, sig) => finish(code ?? 0, sig));

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function normalizeProcessOutput(kind, stdout, stderr = "") {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return { output: stderr.trim() || "[no output]", parsed: null };

  if (kind === "claude-code") {
    const parsed = tryParseJson(trimmed);
    if (parsed) {
      if (Array.isArray(parsed)) {
        for (let i = parsed.length - 1; i >= 0; i -= 1) {
          const event = parsed[i];
          if (typeof event?.result === "string") return { output: event.result, parsed };
          if (typeof event?.message?.content === "string") return { output: event.message.content, parsed };
          const text = contentToText(event?.message?.content);
          if (text) return { output: text, parsed };
        }
      }
      return { output: parsed.result ?? parsed.structured_output ?? JSON.stringify(parsed, null, 2), parsed };
    }
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const parsedLines = lines.map((line) => tryParseJson(line)).filter(Boolean);
  if (parsedLines.length > 0) {
    const final = findFinalJsonOutput(kind, parsedLines);
    if (final) return { output: final, parsed: parsedLines };
  }

  return { output: trimmed, parsed: null };
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findFinalJsonOutput(kind, events) {
  if (kind === "pi") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "agent_end" && Array.isArray(event.messages)) {
        const message = [...event.messages].reverse().find((entry) => entry?.role === "assistant");
        const text = contentToText(message?.content);
        if (text) return text;
      }
      if ((event.type === "message_end" || event.type === "turn_end") && event.message?.role === "assistant") {
        const text = contentToText(event.message.content);
        if (text) return text;
      }
      if (event.assistantMessageEvent?.type === "text_end" && typeof event.assistantMessageEvent.content === "string") {
        return event.assistantMessageEvent.content;
      }
    }
  }

  if (kind === "codex") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      const message = event.message ?? event.msg ?? event.item;
      if (typeof event.result === "string") return event.result;
      if (typeof event.output === "string") return event.output;
      if (typeof message === "string") return message;
      if (typeof message?.text === "string") return message.text;
      if (message?.content) return contentToText(message.content);
    }
  }

  if (kind === "opencode") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (typeof event.text === "string") return event.text;
      if (typeof event.message === "string") return event.message;
      if (event.message?.content) return contentToText(event.message.content);
      if (event.part?.text) return event.part.text;
    }
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (typeof event.result === "string") return event.result;
    if (typeof event.output === "string") return event.output;
    if (typeof event.text === "string") return event.text;
  }
  return null;
}

function truncateTail(text, maxBytes) {
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return { text: value, truncated: false, bytes };
  const marker = `\n[truncated: kept tail, ${bytes - maxBytes} bytes omitted]\n`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  let tail = value.slice(Math.max(0, value.length - (maxBytes - markerBytes)));
  while (Buffer.byteLength(tail, "utf8") + markerBytes > maxBytes) tail = tail.slice(1);
  return { text: `${marker}${tail}`, truncated: true, bytes };
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
