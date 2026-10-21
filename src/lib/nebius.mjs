// Nebius Token Factory request details that were checked against the live docs on 2026-10-21.
// - Model ID: the catalog page tokenfactory.nebius.com/models/catalog/text2text/nvidia%2FNVIDIA-Nemotron-3-Nano-30B-A3B
//   resolves ("Tool calling: Available", "Reasoning: Available"); .../nvidia%2FNemotron-3-Nano-30B-A3B
//   answers "Model not found".
// - reasoning_effort (none | minimal | low | medium | high | xhigh | max) is a documented field of
//   POST /v1/chat/completions (docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion).
// - chat_template_kwargs.enable_thinking is documented by NVIDIA's Nemotron 3 Nano model card for
//   vLLM, not by Nebius. It is sent only when NEBIUS_THINKING is set.
// - Assistant messages may carry the reasoning trace as `reasoning_content` or `reasoning` (both
//   are in the Nebius response schema).

export const DEFAULT_NEBIUS_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

function thinkingMode(env) {
  const mode = String(env.NEBIUS_THINKING ?? "").trim().toLowerCase();
  if (!mode) return null;
  if (mode !== "on" && mode !== "off") throw new Error(`NEBIUS_THINKING must be "on" or "off" (got "${env.NEBIUS_THINKING}").`);
  return mode;
}

function reasoningEffort(env) {
  const effort = String(env.NEBIUS_REASONING_EFFORT ?? "").trim().toLowerCase();
  if (!effort) return null;
  if (!REASONING_EFFORTS.includes(effort)) throw new Error(`NEBIUS_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")} (got "${env.NEBIUS_REASONING_EFFORT}").`);
  return effort;
}

// Extra chat-completion fields for the reasoning settings. Unset variables send nothing, so the
// model's own default applies. Invalid values throw instead of being silently dropped.
export function reasoningParams(env = process.env) {
  const params = {};
  const mode = thinkingMode(env);
  const effort = reasoningEffort(env);
  if (mode) params.chat_template_kwargs = { enable_thinking: mode === "on" };
  if (effort) params.reasoning_effort = effort;
  return params;
}

// What a run report records about the reasoning settings.
export function reasoningLabel(env = process.env) {
  const parts = [];
  const mode = thinkingMode(env);
  const effort = reasoningEffort(env);
  if (mode) parts.push(`enable_thinking=${mode}`);
  if (effort) parts.push(`reasoning_effort=${effort}`);
  return parts.length ? parts.join(", ") : "model default";
}

// The reasoning trace of an assistant message, from whichever documented field carries it.
export function reasoningText(message) {
  for (const key of ["reasoning_content", "reasoning"]) {
    const value = message?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}
