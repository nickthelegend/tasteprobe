// The Nebius catalog check behind GET /api/status must never hang the room: one shared request
// with a short timeout and no retries, a failure cached briefly, and a status read that answers at
// once with "checking" (null). NEBIUS_BASE_URL points at a local socket in this test that accepts
// connections and never answers (a blackhole on 127.0.0.1), so no provider is called and the
// placeholder below is not a key.
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

const sockets = new Set();
let connections = 0;
const blackhole = net.createServer((socket) => { connections++; sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
await new Promise((resolve) => blackhole.listen(0, "127.0.0.1", resolve));
process.env.NEBIUS_API_KEY = "placeholder-not-a-key";
process.env.NEBIUS_BASE_URL = `http://127.0.0.1:${blackhole.address().port}/v1`;
const { CATALOG_TIMEOUT_MS, checkNebiusModel, nebiusModelStatus } = await import("../src/lib/providers.ts");

test.after(() => { for (const socket of sockets) socket.destroy(); blackhole.close(); });

test("a hung catalog: the status read answers 'checking' at once, five callers share one request, it fails within the timeout", { timeout: 20_000 }, async () => {
  const started = Date.now();
  assert.equal(await nebiusModelStatus(200), null);
  assert.ok(Date.now() - started < 1_000, "the status read did not wait for the catalog");
  const results = await Promise.all(Array.from({ length: 5 }, () => checkNebiusModel()));
  const elapsed = Date.now() - started;
  assert.equal(connections, 1, `${connections} outbound connections for 6 concurrent checks`);
  assert.ok(elapsed < CATALOG_TIMEOUT_MS + 2_000, `settled after ${elapsed} ms`);
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.match(result.detail, /^Nebius catalog check failed: /);
  }
  // Cached: the next read answers from the cache, with no new connection.
  assert.deepEqual(await nebiusModelStatus(50), results[0]);
  assert.equal(connections, 1);
});
