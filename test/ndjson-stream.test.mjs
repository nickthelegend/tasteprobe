// The NDJSON stream behind POST /api/audits and /agent, driven with a plain task (no provider
// calls): a client that disconnects mid-run must not lose the run, and nothing may escape start().
import assert from "node:assert/strict";
import test from "node:test";
import { coalescingWriter } from "../src/lib/filestore.mjs";
import { createNdjsonStream } from "../src/lib/ndjson-stream.mjs";

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));
const decoder = new TextDecoder();

async function readEvents(stream, count) {
  const reader = stream.getReader();
  const events = [];
  let buffer = "";
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
  }
  return { reader, events };
}

// The route code this replaces, mirrored: send() enqueues unguarded and the save happens after the
// streamed work, inside start().
function oldRouteStream(state) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for (let persona = 1; persona <= 6; persona++) { await tick(); send({ type: "answer", persona }); }
        state.saved = true;
        send({ type: "done" });
      } catch (error) {
        state.caught = error.message;
        try { send({ type: "error", message: error.message }); } catch (again) { state.caughtAgain = again.message; }
      } finally {
        try { controller.close(); } catch (closing) { state.closeThrew = closing.message; }
      }
    },
  });
}

test("the old route pattern: a client that leaves after 2 personas loses the whole audit", async () => {
  const state = { saved: false };
  const { reader, events } = await readEvents(oldRouteStream(state), 2);
  assert.equal(events.length, 2);
  await reader.cancel();
  await tick(30);
  assert.equal(state.saved, false, "the paid-for answers were never saved");
  assert.match(state.caught, /Invalid state|closed/i);
});

test("a client that disconnects after 2 events: the run still finishes and saves, and no error escapes", async () => {
  const state = { saved: false, sendsAfterLeave: [] };
  let settled = null;
  const { stream, done } = createNdjsonStream(async (send) => {
    for (let persona = 1; persona <= 6; persona++) {
      await tick();
      const delivered = send({ type: "answer", persona });
      if (persona > 2) state.sendsAfterLeave.push(delivered);
    }
    state.saved = true;
    send({ type: "done" });
  }, { heartbeatMs: 0, onError: (error) => ({ type: "error", message: error.message }), onSettled: (outcome) => { settled = outcome; } });
  const { reader, events } = await readEvents(stream, 2);
  assert.deepEqual(events.map((event) => event.persona), [1, 2]);
  await reader.cancel();
  const outcome = await done;
  assert.deepEqual(outcome, { ok: true });
  assert.equal(state.saved, true, "the audit is saved although nobody is listening");
  assert.ok(state.sendsAfterLeave.length >= 3 && state.sendsAfterLeave.at(-1) === false, "sends after the client left are dropped, not thrown");
  assert.deepEqual(settled, { ok: true }, "onSettled runs (it frees the run slot)");
});

test("a connected client gets every event, then the stream closes", async () => {
  const { stream, done } = createNdjsonStream(async (send) => { send({ type: "stage" }); await tick(); send({ type: "done" }); }, { heartbeatMs: 0 });
  const { events } = await readEvents(stream, 10);
  assert.deepEqual(events.map((event) => event.type), ["stage", "done"]);
  assert.deepEqual(await done, { ok: true });
});

test("a failing task reports one error event and settles with the error", async () => {
  let settled = null;
  const { stream, done } = createNdjsonStream(async (send) => { send({ type: "stage" }); throw new Error("Qloo /search returned 502"); }, {
    heartbeatMs: 0, onError: (error) => ({ type: "error", message: error.message }), onSettled: (outcome) => { settled = outcome; },
  });
  const { events } = await readEvents(stream, 10);
  assert.deepEqual(events, [{ type: "stage" }, { type: "error", message: "Qloo /search returned 502" }]);
  assert.equal((await done).ok, false);
  assert.equal(settled.ok, false);
});

test("heartbeat lines keep an idle connection alive while a slow call runs, and stop at the end", async () => {
  const { stream, done } = createNdjsonStream(async (send) => { await tick(130); send({ type: "done" }); }, { heartbeatMs: 25 });
  const { events } = await readEvents(stream, 50);
  const beats = events.filter((event) => event.type === "heartbeat");
  assert.ok(beats.length >= 3, `expected heartbeats during the 130 ms wait, got ${beats.length}`);
  assert.ok(beats.every((event) => !Number.isNaN(Date.parse(event.at))));
  assert.equal(events.at(-1).type, "done");
  await done;
});

test("incremental writes: never two at once, and the last write sees the latest state", async () => {
  let active = 0, peak = 0, writes = 0, state = 0, written = -1;
  const writer = coalescingWriter(async () => {
    active++; peak = Math.max(peak, active); writes++;
    const snapshot = state;
    await tick(5);
    written = snapshot;
    active--;
  });
  for (let step = 1; step <= 20; step++) { state = step; writer.schedule(); await tick(1); }
  await writer.drain();
  assert.equal(peak, 1);
  assert.equal(written, 20);
  assert.ok(writes < 20, `writes are coalesced (${writes} for 20 updates)`);
});
