// The minimum setup is two keys: Qloo and Nebius, with the assistant under test on Nebius Token
// Factory through MODEL_2_*. No call is made here; only which variables count as configured.
// The values below are placeholders, not keys.
import assert from "node:assert/strict";
import test from "node:test";

const NAMES = ["QLOO_API_KEY", "NEBIUS_API_KEY", "OPENAI_API_KEY", "MODEL_2_API_KEY", "MODEL_2_BASE_URL", "MODEL_2_ID", "MODEL_2_NAME", "MODEL_3_API_KEY", "MODEL_3_BASE_URL", "MODEL_3_ID"];
for (const name of NAMES) delete process.env[name];
const { assistantsMeta, getTestModels, missingKeys, requireKeys } = await import("../src/lib/providers.ts");

function withEnv(values, fn) {
  const before = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const name of NAMES) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
  }
}

const TWO_KEYS = {
  QLOO_API_KEY: "placeholder-qloo",
  NEBIUS_API_KEY: "placeholder-nebius",
  MODEL_2_BASE_URL: "https://api.tokenfactory.nebius.com/v1",
  MODEL_2_API_KEY: "placeholder-nebius",
  MODEL_2_ID: "meta-llama/Llama-3.3-70B-Instruct",
  MODEL_2_NAME: "Llama 3.3 70B on Nebius",
};

test("two keys are enough: Qloo + Nebius, the assistant under test on Nebius through MODEL_2_*", () => withEnv(TWO_KEYS, () => {
  assert.deepEqual(missingKeys(), []);
  assert.doesNotThrow(() => requireKeys());
  assert.deepEqual(getTestModels(), ["Llama 3.3 70B on Nebius"]);
  assert.deepEqual(assistantsMeta(), [{ name: "Llama 3.3 70B on Nebius", model: "meta-llama/Llama-3.3-70B-Instruct", host: "api.tokenfactory.nebius.com" }]);
}));

test("no assistant at all names OPENAI_API_KEY", () => withEnv({ QLOO_API_KEY: "q", NEBIUS_API_KEY: "n" }, () => {
  assert.deepEqual(missingKeys(), ["OPENAI_API_KEY"]);
  assert.throws(() => requireKeys(), /No assistant to test/);
}));

test("a partly set MODEL_2 slot names its missing variables instead of being ignored", () => {
  withEnv({ ...TWO_KEYS, MODEL_2_ID: "" }, () => {
    assert.deepEqual(missingKeys(), ["MODEL_2_ID"]);
    assert.throws(() => requireKeys(), /Assistant endpoint incomplete: set MODEL_2_ID/);
  });
  // An OpenAI key does not hide a broken extra slot either.
  withEnv({ ...TWO_KEYS, OPENAI_API_KEY: "placeholder-openai", MODEL_2_BASE_URL: "", MODEL_2_API_KEY: "" }, () => {
    assert.deepEqual(missingKeys(), ["MODEL_2_API_KEY", "MODEL_2_BASE_URL"]);
  });
});
