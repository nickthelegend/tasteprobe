import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NEBIUS_MODEL, REASONING_EFFORTS, reasoningLabel, reasoningParams, reasoningText } from "../src/lib/nebius.mjs";

test("default model is the Token Factory catalog ID for Nemotron 3 Nano", () => {
  assert.equal(DEFAULT_NEBIUS_MODEL, "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B");
});

test("unset reasoning variables send nothing and report the model default", () => {
  assert.deepEqual(reasoningParams({}), {});
  assert.deepEqual(reasoningParams({ NEBIUS_THINKING: "", NEBIUS_REASONING_EFFORT: "  " }), {});
  assert.equal(reasoningLabel({}), "model default");
});

test("NEBIUS_THINKING maps to chat_template_kwargs.enable_thinking", () => {
  assert.deepEqual(reasoningParams({ NEBIUS_THINKING: "off" }), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(reasoningParams({ NEBIUS_THINKING: "ON" }), { chat_template_kwargs: { enable_thinking: true } });
  assert.equal(reasoningLabel({ NEBIUS_THINKING: "off" }), "enable_thinking=off");
});

test("NEBIUS_REASONING_EFFORT maps to the documented reasoning_effort field", () => {
  for (const effort of REASONING_EFFORTS) assert.deepEqual(reasoningParams({ NEBIUS_REASONING_EFFORT: effort }), { reasoning_effort: effort });
  assert.deepEqual(reasoningParams({ NEBIUS_REASONING_EFFORT: "low", NEBIUS_THINKING: "on" }), { chat_template_kwargs: { enable_thinking: true }, reasoning_effort: "low" });
  assert.equal(reasoningLabel({ NEBIUS_REASONING_EFFORT: "low", NEBIUS_THINKING: "on" }), "enable_thinking=on, reasoning_effort=low");
});

test("invalid reasoning values throw with the accepted values", () => {
  assert.throws(() => reasoningParams({ NEBIUS_THINKING: "maybe" }), /NEBIUS_THINKING must be "on" or "off"/);
  assert.throws(() => reasoningParams({ NEBIUS_REASONING_EFFORT: "extreme" }), /none, minimal, low, medium, high, xhigh, max/);
});

test("reasoning trace is read from reasoning_content, then reasoning", () => {
  assert.equal(reasoningText({ reasoning_content: "a", reasoning: "b" }), "a");
  assert.equal(reasoningText({ reasoning: "b" }), "b");
  assert.equal(reasoningText({ content: "c" }), "");
  assert.equal(reasoningText(null), "");
});
