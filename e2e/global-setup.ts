import { DEV, PUBLIC, STANDALONE } from "./playwright.config";

// The servers are started separately (e2e/stack.sh) so their PIDs are known and killed by PID
// afterwards. Fail loudly if they are not up, if any has a provider key, if the two no-keys targets
// have a stored audit, or if the public-demo target is not locked and seeded as e2e/stack.sh sets it up.
export default async function globalSetup() {
  for (const base of [DEV, STANDALONE, PUBLIC]) {
    const status = await fetch(`${base}/api/status`).catch((error) => {
      throw new Error(`TasteProbe is not running at ${base} (${error.cause?.code ?? error.message}). Start it with: npm run e2e:stack`);
    });
    if (!status.ok) throw new Error(`${base}/api/status answered ${status.status}`);
    const body = await status.json();
    if (body.qloo || body.nebius.configured || body.systems.length) throw new Error(`${base} has a provider key configured; this suite covers the no-keys journey only.`);
    const listing = await fetch(`${base}/api/audits`);
    const audits = await listing.json();
    if (base === PUBLIC) {
      if (!body.runs?.locked || body.runs.maxPersonas !== 24) throw new Error(`${base} should be the locked public demo with a 24-persona cap (e2e/stack.sh).`);
      if (listing.headers.get("x-total-count") !== "14") throw new Error(`${base} should hold the 14 seeded synthetic audits, not ${listing.headers.get("x-total-count")}.`);
    } else if (audits.length) {
      throw new Error(`${base} has ${audits.length} stored audits; the suite expects an empty store.`);
    }
  }
}
