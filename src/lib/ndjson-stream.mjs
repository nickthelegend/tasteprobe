// NDJSON response stream for long runs (an audit, an agent loop) that survives the client leaving.
//
// The work is started once and always runs to the end, so an audit whose tab was closed (or whose
// proxy cut the connection) is still saved and shows up under Past flights. Writes to a stream the
// client has cancelled, or that the platform already closed, are dropped instead of throwing into
// the work. A heartbeat line keeps idle proxies from closing the connection while a slow call runs.
//
//   const { stream, done } = createNdjsonStream(async (send) => { ...; send({ type: "done" }) }, {
//     onError: (error) => ({ type: "error", message: error.message }),
//     onSettled: () => release(),
//   });
//   return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });

export const HEARTBEAT_MS = 15_000;

export function createNdjsonStream(task, { heartbeatMs = HEARTBEAT_MS, onError, onSettled } = {}) {
  const encoder = new TextEncoder();
  let controller = null;
  let open = true;
  let timer = null;
  const stopHeartbeat = () => { if (timer) clearInterval(timer); timer = null; };

  // Returns false once the client is gone; never throws.
  const send = (event) => {
    if (!open || !controller) return false;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      return true;
    } catch {
      open = false;
      stopHeartbeat();
      return false;
    }
  };

  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const stream = new ReadableStream({
    start(streamController) {
      controller = streamController;
      if (heartbeatMs > 0) timer = setInterval(() => send({ type: "heartbeat", at: new Date().toISOString() }), heartbeatMs);
      // Not awaited: start() returns at once and the task runs to the end whatever the client does.
      Promise.resolve()
        .then(() => task(send))
        .then(
          () => ({ ok: true }),
          (error) => {
            try { if (onError) send(onError(error)); } catch { /* reporting the error must not lose the outcome */ }
            return { ok: false, error };
          },
        )
        .then((outcome) => {
          stopHeartbeat();
          if (open) { open = false; try { controller.close(); } catch { /* already closed by the platform */ } }
          try { onSettled?.(outcome); } catch { /* settling must not throw */ }
          resolveDone(outcome);
        });
    },
    cancel() {
      // The client left. Stop writing, keep working.
      open = false;
      stopHeartbeat();
    },
  });

  return { stream, done, isOpen: () => open };
}
