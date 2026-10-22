import assert from "node:assert/strict";
import test from "node:test";
import { QLOO_HACKATHON_BASE_URL, readQlooResponse } from "../src/lib/qloo.mjs";
import { pickPlace } from "../src/lib/taste.mjs";

test("a 200 body is parsed as JSON", () => {
  const body = JSON.stringify({ success: true, results: { tags: [] } });
  assert.deepEqual(readQlooResponse({ path: "/v2/insights", status: 200, body }), { success: true, results: { tags: [] } });
});

test("/search 404 is Qloo's documented 'No results' and reads as an empty list", () => {
  const payload = readQlooResponse({ path: "/search", status: 404, body: "" });
  assert.deepEqual(payload.results, []);
  assert.equal(payload.noResults, true);
  // The audit then stops with the readable 'no place' message instead of a raw 404.
  assert.throws(() => pickPlace(payload.results, "Nowhere Bar", "Mumbai"), /Qloo found no place called “Nowhere Bar”/);
});

test("a 404 on /v2/insights stays an error", () => {
  assert.throws(() => readQlooResponse({ path: "/v2/insights", status: 404, body: "no such thing" }), (error) => {
    assert.equal(error.message, "Qloo /v2/insights returned 404 (not found).");
    assert.equal(error.detail, "no such thing");
    return true;
  });
});

test("401 names the hackathon host when QLOO_BASE_URL points elsewhere", () => {
  assert.throws(() => readQlooResponse({ path: "/search", status: 401, body: "{}", baseUrl: "https://api.qloo.com" }),
    /QLOO_BASE_URL points at api\.qloo\.com; hackathon keys only work against https:\/\/hackathon\.api\.qloo\.com/);
  assert.throws(() => readQlooResponse({ path: "/search", status: 401, body: "{}", baseUrl: QLOO_HACKATHON_BASE_URL }), /401 \(key rejected\)\. Check QLOO_API_KEY\./);
});

test("403 on /v2/insights names the filter.type that was refused", () => {
  assert.throws(() => readQlooResponse({ path: "/v2/insights", params: { "filter.type": "urn:demographics" }, status: 403, body: "You do not have permission" }),
    /403 for filter\.type=urn:demographics: Qloo says this type is not enabled for your key/);
});

test("a non-JSON 200 body is an error, not a crash", () => {
  assert.throws(() => readQlooResponse({ path: "/search", status: 200, body: "<html>" }), /not JSON/);
});

test("an error message never quotes Qloo's response body (messages are stored and served publicly)", () => {
  const body = '{"raw":"payload","results":{"secret":"value"}}';
  const cases = [
    { path: "/v2/insights", params: { "filter.type": "urn:tag" }, status: 403 },
    { path: "/v2/insights", params: { "filter.type": "urn:entity:artist" }, status: 500 },
    { path: "/search", status: 429 },
    { path: "/search", status: 200, body: "<html>raw payload</html>" },
  ];
  for (const item of cases) {
    assert.throws(() => readQlooResponse({ body, ...item }), (error) => {
      assert.doesNotMatch(error.message, /payload|secret|raw/, error.message);
      assert.ok(error.detail.length > 0, "the body stays on detail, server-side");
      return true;
    });
  }
  assert.throws(() => readQlooResponse({ path: "/v2/insights", params: { "filter.type": "urn:tag" }, status: 403, body }),
    { message: "Qloo /v2/insights returned 403 for filter.type=urn:tag: Qloo says this type is not enabled for your key." });
});
