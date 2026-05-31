import { createPacket, taskForKind } from "./packets.js";
import { getParticipant } from "./state.js";
import { runParticipant } from "./runners.js";

const ADVISORY_ROLES = new Set(["reviewer", "council", "knowledge"]);

// Resolve the tools policy actually used at runtime. Honor the participant's configured policy,
// but force read-only when its roles are purely advisory — advisor-style participants must never
// receive write flags, even if misconfigured otherwise.
export function effectiveToolsPolicy(participant) {
  const roles = Array.isArray(participant.roles) ? participant.roles : [];
  const purelyAdvisory = roles.length > 0 && roles.every((role) => ADVISORY_ROLES.has(role));
  if (purelyAdvisory) return "readonly";
  return participant.toolsPolicy ?? "readonly";
}

export function participantForKind(participant, _kind) {
  const toolsPolicy = effectiveToolsPolicy(participant);
  if (toolsPolicy === participant.toolsPolicy) return participant;
  return { ...participant, toolsPolicy };
}

export async function runNamedParticipant(input) {
  const { cwd, participantRef, kind = "ask", task, signal, specPath, diff, extraContext, handoff, timeoutMs } = input;
  const configuredParticipant = typeof participantRef === "object" ? participantRef : await getParticipant(cwd, participantRef);
  if (!configuredParticipant) throw new Error(`Unknown participant: ${participantRef}`);
  const participant = participantForKind(configuredParticipant, kind);
  const finalTask = taskForKind(kind, task);
  const packet = await createPacket({ cwd, participant, kind, task: finalTask, specPath, diff, extraContext, handoff });
  return await runParticipant({ cwd, participant, packet, kind, signal, timeoutMs });
}
