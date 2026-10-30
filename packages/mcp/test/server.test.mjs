import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {createProtocolServer} from "../src/server.mjs";
import {commitment, PROFILES} from "../../sdk/client.mjs";

const hash = "0x" + "12".repeat(32), other = "0x" + "13".repeat(32), key = "ig_" + "a".repeat(43);
const payment = {destinationChainId: 84532, recipient: "0x" + "34".repeat(20), amount: "1.000001", purchaseDescription: "Approved protocol data", justification: "Required by the owner-approved research mission", category: "data", invoiceId: "controlled-test-invoice", evidence: [{url: "https://merchant.example/invoice.json"}]};
const policy = {version: 1, name: "MCP controlled fixture", mission: "Approved research", taskContext: "Research protocol data", allowedCategories: ["data"], prohibitedPurchases: ["advertising"], exceptions: [], financial: {totalBudget: "10", perPaymentLimit: "2", periodBudget: "10", periodSeconds: 86400, validFrom: 1, validUntil: 4102444800}, merchants: [{name: "Controlled merchant", recipient: payment.recipient, origins: ["https://merchant.example"], products: ["Protocol data"]}], evidence: {requiredTypes: ["invoice"], approvedOrigins: ["https://merchant.example"], maxAgeSeconds: 3600}, criteria: [{id: "mission", description: "Evidence supports the mission"}]};
const policyHash = await commitment(policy);
function metadata() { return {paymentEnvironment: "testnet", reviewEnvironment: "testnet", reviewNetwork: "studionet", reviewChainId: 61999}; }
function config(base) { return {...metadata(), mode: "testnet", chainId: 1952, apiOrigin: base, frontendOrigin: base, applicationUrl: base, ownerSessionTransport: "cookie", reviewInfrastructure: "studionet-simulator", releaseId: "controlled-testnet-release", sourceCommit: "a".repeat(40), settlementVersion: 1, configured: true, readinessReasons: [], token: "0x" + "45".repeat(20), assets: [{asset: "USDC", symbol: "USDC", chainId: 1952, decimals: 6, token: PROFILES.testnet.sourceUSDC, available: true, reason: "Controlled test fixture", sources: []}], spendingNetworks: [1952, 84532].map(chainId => ({chainId, name: "Controlled route", ...PROFILES.testnet.routes[chainId], explorerUrl: "https://explorer.example"})), cctpFactoryAddress: "0x" + "46".repeat(20)}; }
async function connect(baseUrl, apiKey = key, paymentEnvironment = "testnet") {
  const transport = new StdioClientTransport({command: process.execPath, args: [fileURLToPath(new URL("../src/cli.mjs", import.meta.url))], env: {...process.env, INTENTGUARD_BASE_URL: baseUrl, INTENTGUARD_PAYMENT_ENV: paymentEnvironment, INTENTGUARD_API_KEY: apiKey}, stderr: "pipe"});
  let stderr = ""; transport.stderr?.on("data", c => { stderr += c.toString(); });
  const client = new Client({name: "intentguard-stdio-test", version: "1.0.0"}); await client.connect(transport);
  return {client, stderr: () => stderr};
}

test("real stdio MCP preserves anonymous config, fresh card preflight, admission, recovery and HTTP errors", {timeout: 60000}, async () => {
  let base, submitted, requestCount = 0, state = "QUEUED", configChange = {}, malformed = false;
  const seen = [];
  const api = createServer(async (req, res) => {
    seen.push({path: req.url, headers: req.headers, method: req.method});
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    res.setHeader("Content-Type", "application/json"); res.setHeader("X-Request-Id", "controlled-correlation");
    const send = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (req.url === "/api/v1/config") return send(200, {...config(base), ...configChange});
    if (req.url === "/api/v1/health") return send(503, {...metadata(), status: "degraded", paymentChainId: 1952, readinessReasons: ["WORKER_STALE"]});
    if (req.url.startsWith("/api/v1/explorer/agents?")) return send(200, {agents: [], nextCursor: null});
    if (req.url === "/api/v1/explorer/agents/" + hash + "/card") return send(200, {agent: {id: hash}, usage: {requestCount, fundsMoved: state === "PAID" ? "1.000001" : "0", asOf: Date.now()}, shareUrl: base + "/explorer?agentId=" + hash});
    if (req.url === "/api/v1/explorer/transactions/" + hash + "/proof") return send(404, {error: {code: "PROOF_UNAVAILABLE", message: "No captured CCTP proof", retryable: false, requestId: "proof-missing"}});
    if (req.headers.authorization !== "Bearer " + key) return send(401, {error: {code: "KEY_REQUIRED", message: "Credential required", retryable: false}});
    if (req.url === "/api/v1/me") {
      if (malformed) { res.setHeader("Content-Type", "text/html"); res.end("<html>unavailable</html>"); return; }
      return send(200, {card: {...metadata(), id: hash, address: "0x" + "34".repeat(20), chainId: 1952, token: PROFILES.testnet.sourceUSDC, status: "ACTIVE", policy, policyHash, settlement: {asset: "USDC", destinationChainIds: [1952, 84532]}, reviewerVersion: 3, reviewerAddress: "0x" + "47".repeat(20), balances: {spent: "0"}}, serverEcho: key});
    }
    if (req.url === "/api/v1/requests" && req.method === "POST") {
      assert.equal(req.headers["idempotency-key"], "stable-operation"); assert.equal(req.headers["x-intentguard-environment"], "testnet");
      if (submitted && JSON.stringify(body) !== JSON.stringify(submitted)) return send(409, {error: {code: "IDEMPOTENCY_CONFLICT", message: "Input changed " + key, retryable: false, requestId: "conflict-id", details: [{message: key}]}});
      if (!submitted) { submitted = body; requestCount++; } return send(202, {id: hash, status: state});
    }
    if (req.url === "/api/v1/requests/" + hash) return send(200, {...metadata(), id: hash, cardId: hash, status: state, ...(state === "PAID" ? {paymentTxHash: other} : {})});
    if (req.url === "/api/v1/requests/" + other) { res.setHeader("Retry-After", "9"); return send(404, {error: {code: "NOT_FOUND", message: "Request missing", retryable: false, requestId: "missing-id"}}); }
    send(404, {error: {code: "NOT_FOUND", message: "Not found", retryable: false}});
  });
  await new Promise(r => api.listen(0, "127.0.0.1", r)); base = "http://127.0.0.1:" + api.address().port;
  const {client, stderr} = await connect(base);
  try {
    const listing = await client.listTools(), names = listing.tools.map(t => t.name);
    for (const name of ["get_config", "get_health", "get_my_agent", "submit_payment", "get_payment", "wait_for_payment", "get_agent_card", "get_transaction", "get_bridge_proof"]) assert.ok(names.includes(name));
    const submit = listing.tools.find(t => t.name === "submit_payment"); assert.equal(submit.annotations.readOnlyHint, false); assert.equal(submit.annotations.destructiveHint, true);
    const resources = await client.listResources(); assert.equal(resources.resources.length, 3);
    assert.match((await client.readResource({uri: "intentguard://protocol"})).contents[0].text, /Idempotency-Key/);
    const bundledSchema = JSON.parse((await client.readResource({uri: "intentguard://openapi"})).contents[0].text);
    assert.equal(bundledSchema.openapi, "3.1.0");
    for (const path of ["/sandbox", "/sandbox/session", "/sandbox/requests", "/sandbox/requests/{id}"]) assert.ok(bundledSchema.paths[path]);
    assert.deepEqual(bundledSchema.paths["/sandbox/requests"].post.security, [{SandboxVisitor: []}]);
    assert.ok(bundledSchema.components.schemas.DraftView.properties.input);
    const bundledGuide = JSON.parse((await client.readResource({uri: "intentguard://integration"})).contents[0].text);
    assert.equal(bundledGuide.review.versionForSettlementV2, 4);
    assert.deepEqual(bundledGuide.agentSetup.templates, ["research", "api-access", "protocol-test"]);
    assert.equal(bundledGuide.visitorSandbox.paymentChainId, 1952);
    assert.equal(bundledGuide.visitorSandbox.session.sdkReturnsCapability, false);
    assert.equal(bundledGuide.visitorSandbox.mcpVisitorToolsInstalled, false);
    assert.equal(names.some(name => /sandbox|visitor/i.test(name)), false, "agent MCP has no visitor/owner authority");
    const c = await client.callTool({name: "get_config", arguments: {}}); assert.equal(c.structuredContent.data.chainId, 1952); assert.equal(seen.at(-1).headers.authorization, undefined);
    await client.callTool({name: "list_agents", arguments: {limit: 3}}); assert.equal(seen.at(-1).headers.authorization, undefined);
    const me = await client.callTool({name: "get_my_agent", arguments: {}}); assert.equal(me.structuredContent.data.serverEcho, "[REDACTED]"); assert.equal(JSON.stringify(me).includes(key), false);
    const before = seen.length;
    for (const bad of [{...payment, amount: "0"}, {...payment, amount: "1.0000001"}, {...payment, destinationChainId: "84532"}, {...payment, cardId: other}, {...payment, evidence: [payment.evidence[0], payment.evidence[0]]}, {...payment, evidence: [{url: "https://127.0.0.1/invoice"}]}]) assert.equal((await client.callTool({name: "submit_payment", arguments: {payment: bad, idempotencyKey: "stable-operation"}})).isError, true);
    assert.equal(seen.length, before, "invalid input never reaches HTTP");
    const first = await client.callTool({name: "submit_payment", arguments: {payment, idempotencyKey: "stable-operation"}}); assert.equal(first.structuredContent.status, 202); assert.equal(first.structuredContent.data.id, hash);
    assert.deepEqual(seen.slice(-3).map(s => s.path), ["/api/v1/config", "/api/v1/me", "/api/v1/requests"]); assert.equal(seen.at(-3).headers.authorization, undefined);
    await client.callTool({name: "submit_payment", arguments: {payment, idempotencyKey: "stable-operation"}}); assert.equal(requestCount, 1);
    const conflict = await client.callTool({name: "submit_payment", arguments: {payment: {...payment, amount: "2"}, idempotencyKey: "stable-operation"}}); assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_CONFLICT"); assert.equal(conflict.structuredContent.error.status, 409); assert.equal(conflict.structuredContent.error.requestId, "conflict-id"); assert.equal(JSON.stringify(conflict).includes(key), false);
    for (const pending of ["QUEUED", "BRIDGING", "AWAITING_ATTESTATION", "MINTING"]) { state = pending; const r = await client.callTool({name: "wait_for_payment", arguments: {id: hash, maxWaitMs: 0}}); assert.equal(r.structuredContent.pending, true); assert.equal(r.structuredContent.operationId, hash); }
    for (const terminal of ["PAID", "BLOCKED", "REJECTED", "NEEDS_EVIDENCE", "EXPIRED", "CANCELLED"]) { state = terminal; const r = await client.callTool({name: "wait_for_payment", arguments: {id: hash, maxWaitMs: 0}}); assert.equal(r.structuredContent.data.status, terminal); assert.equal(r.structuredContent.pending, undefined); }
    assert.equal(requestCount, 1);
    const missing = await client.callTool({name: "get_payment", arguments: {id: other}}); assert.equal(missing.structuredContent.error.status, 404); assert.equal(missing.structuredContent.error.code, "NOT_FOUND"); assert.equal(missing.structuredContent.error.retryAfterSeconds, 9);
    const proof = await client.callTool({name: "get_bridge_proof", arguments: {id: hash}}); assert.equal(proof.structuredContent.error.code, "PROOF_UNAVAILABLE"); assert.equal(seen.at(-1).headers.authorization, undefined);
    state = "PAID"; await client.callTool({name: "get_agent_card", arguments: {id: hash}}); assert.equal(seen.at(-1).headers.authorization, undefined);
    for (const change of [{paymentEnvironment: "mainnet"}, {apiOrigin: "https://different.example"}, {reviewChainId: 4221}]) {
      configChange = change; const start = seen.length; const r = await client.callTool({name: "submit_payment", arguments: {payment, idempotencyKey: "stable-operation"}}); assert.equal(r.isError, true); assert.equal(seen.length, start + 1); assert.equal(seen.at(-1).headers.authorization, undefined); assert.equal(requestCount, 1);
    }
    configChange = {}; malformed = true; const nonJson = await client.callTool({name: "get_my_agent", arguments: {}}); assert.equal(nonJson.structuredContent.error.code, "INVALID_RESPONSE");
    assert.equal(stderr().includes(key), false);
  } finally { await client.close(); await new Promise(r => api.close(r)); }
});

test("explicit origin/environment is required and unsafe origins fail before connecting", () => {
  for (const baseUrl of ["http://example.com", "https://name:password@example.com", "https://example.com/api", "https://example.com/?key=sensitive", "file:///tmp"]) assert.throws(() => createProtocolServer({baseUrl, paymentEnvironment: "testnet"}));
  assert.throws(() => createProtocolServer({baseUrl: "https://intentguard-tapeout.vercel.app"}));
  assert.ok(createProtocolServer({baseUrl: "https://intentguard-tapeout.vercel.app", paymentEnvironment: "testnet"}));
});

test("missing or cross-environment keys fail without HTTP", {timeout: 15000}, async () => {
  for (const [apiKey, code] of [["", "KEY_REQUIRED"], ["ig_mainnet_" + "b".repeat(43), "CREDENTIAL_ENVIRONMENT_MISMATCH"]]) {
    const {client} = await connect("http://127.0.0.1:1", apiKey);
    try { const r = await client.callTool({name: "get_my_agent", arguments: {}}); assert.equal(r.isError, true); assert.equal(r.structuredContent.error.code, code); }
    finally { await client.close(); }
  }
});
