// The MCP server over real stdio: the SDK client spawns `node src/mcp/server.mjs` with a clean
// environment (no keys, empty temp working directory and data dir) and calls its tools.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = fileURLToPath(new URL("../src/mcp/server.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/audit-synthetic.json", import.meta.url));
const AUDIT_ID = "00000000-0000-4000-8000-000000000001";

async function connect(dataDir, cwd) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: cwd, TASTEPROBE_DATA_DIR: dataDir },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasteprobe-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

// An invalid argument may surface as a JSON-RPC error or as an isError tool result, depending on
// the SDK version; both must name the bad field and neither may run the tool.
async function rejects(client, name, args, field) {
  try {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} accepted invalid ${field}`);
    assert.match(result.content[0].text, new RegExp(field));
    assert.doesNotMatch(result.content[0].text, /Setup required/);
  } catch (error) {
    assert.match(String(error.message), new RegExp(field));
  }
}

test("MCP server over stdio: tools, Setup required without keys, input validation and stored reports", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "tasteprobe-mcp-"));
  const dataDir = path.join(root, "data");
  const client = await connect(dataDir, root);
  t.after(async () => { await client.close(); await rm(root, { recursive: true, force: true }); });

  await t.test("lists run_audit, run_fix and get_report with input schemas", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["get_report", "run_audit", "run_fix"]);
    const audit = tools.find((tool) => tool.name === "run_audit");
    assert.deepEqual(audit.inputSchema.required.sort(), ["brand", "city"]);
    assert.equal(audit.inputSchema.properties.personas.minimum, 8);
  });

  await t.test("run_audit without keys answers Setup required and names every missing variable", async () => {
    const result = await client.callTool({ name: "run_audit", arguments: { brand: "Any Venue", city: "Mumbai" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^Setup required: QLOO_API_KEY, NEBIUS_API_KEY, OPENAI_API_KEY\./);
    assert.match(result.content[0].text, /No API call was made/);
    assert.deepEqual(result.structuredContent, { error: "setup_required", missing: ["QLOO_API_KEY", "NEBIUS_API_KEY", "OPENAI_API_KEY"] });
  });

  await t.test("run_fix without keys answers Setup required before looking anything up", async () => {
    const result = await client.callTool({ name: "run_fix", arguments: { audit_id: AUDIT_ID } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^Setup required: QLOO_API_KEY/);
  });

  await t.test("invalid input is rejected before the tool runs", async () => {
    await rejects(client, "run_audit", { city: "Mumbai" }, "brand");
    await rejects(client, "run_audit", { brand: "Any Venue", city: "Mumbai", personas: 3 }, "personas");
    await rejects(client, "run_fix", { audit_id: "not-an-id" }, "audit_id");
    await rejects(client, "get_report", { audit_id: "../../etc/passwd" }, "audit_id");
  });

  await t.test("get_report with an empty store says so honestly", async () => {
    const result = await client.callTool({ name: "get_report", arguments: {} });
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /No audits are stored yet/);
    assert.deepEqual(result.structuredContent, { audits: [] });
  });

  await t.test("get_report reads a stored audit (synthetic fixture) and reports unknown ids", async () => {
    const audit = JSON.parse(await readFile(fixture, "utf8"));
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, "audits.json"), JSON.stringify([audit]));

    const listing = await client.callTool({ name: "get_report", arguments: {} });
    assert.equal(listing.structuredContent.audits[0].id, AUDIT_ID);

    const result = await client.callTool({ name: "get_report", arguments: { audit_id: AUDIT_ID } });
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /Fixture Venue \(synthetic\)/);
    assert.match(result.content[0].text, /Whole flight: 20% of 30 usable answers recommend it \(95% 9–38%\); 2 of 32 dropped/);
    assert.match(result.content[0].text, /Fix attempt 1 on Place keyword: fix − placebo \+33 pts \(95% 10–55%\), clears zero/);
    assert.match(result.content[0].text, /Printable report: \/audits\/00000000-0000-4000-8000-000000000001\/report/);
    assert.equal(result.structuredContent.overall.share, 0.2);
    assert.equal(result.structuredContent.segments.length, 2);

    const missing = await client.callTool({ name: "get_report", arguments: { audit_id: "00000000-0000-4000-8000-000000000999" } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /No audit with id 00000000-0000-4000-8000-000000000999 is stored/);
  });
});
