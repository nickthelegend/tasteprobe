// The servers are started separately (e2e/stack.sh) so their PIDs are known and killed by PID
// afterwards. Fail loudly if they are not up, or if either one has a key or a stored audit,
// instead of testing something other than the honest no-keys journey.
export default async function globalSetup() {
  for (const base of ["http://127.0.0.1:3101", "http://127.0.0.1:3102"]) {
    const status = await fetch(`${base}/api/status`).catch((error) => {
      throw new Error(`TasteProbe is not running at ${base} (${error.cause?.code ?? error.message}). Start it with: npm run e2e:stack`);
    });
    if (!status.ok) throw new Error(`${base}/api/status answered ${status.status}`);
    const body = await status.json();
    if (body.qloo || body.nebius.configured || body.systems.length) throw new Error(`${base} has a provider key configured; this suite covers the no-keys journey only.`);
    const audits = await (await fetch(`${base}/api/audits`)).json();
    if (audits.length) throw new Error(`${base} has ${audits.length} stored audits; the suite expects an empty store.`);
  }
}
