import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonObject } from "../src/lib/json.mjs";

test("parses plain, fenced, prose-wrapped and think-prefixed JSON", () => {
  assert.deepEqual(parseJsonObject('{"entities":["A"]}'), { entities: ["A"] });
  assert.deepEqual(parseJsonObject('```json\n{"entities":["A","B"]}\n```'), { entities: ["A", "B"] });
  assert.deepEqual(parseJsonObject('Sure! {"change":"x {y}"} hope that helps'), { change: "x {y}" });
  assert.deepEqual(parseJsonObject('<think>maybe {"entities":[]}</think>{"entities":["Final"]}'), { entities: ["Final"] });
  assert.deepEqual(parseJsonObject('{"outer":{"inner":1}}'), { outer: { inner: 1 } });
});

test("throws a clear error when no object is present", () => {
  assert.throws(() => parseJsonObject("no json here"), /no JSON object/);
  assert.throws(() => parseJsonObject("[1,2]"), /no JSON object/);
});
