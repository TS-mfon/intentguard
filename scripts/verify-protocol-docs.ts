import assert from "node:assert/strict";
import {readFile, access} from "node:fs/promises";
import {resolve, dirname} from "node:path";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {privateKeyToAccount} from "viem/accounts";
import {docsSections} from "../apps/web/app/docs/sections";
import {paymentSchema, policySchema, settlementSchema, settlementV2Schema, parseAmount, digest, canonical, type CardView} from "../packages/shared";
import {parseStrictJson} from "../packages/shared/strict-json";
import {PROFILES, REQUEST_STATES, TERMINAL_STATES, normalizeSettlement, validatePayment} from "../packages/sdk/client.mjs";
import {profileRoutes, sourceToken, USDT0_MAINNET} from "../packages/shared/payment-profiles";
import {createApi} from "../apps/web/lib/api";
import {MemoryStore} from "../apps/web/lib/store";
import {issueKey} from "../apps/web/lib/auth";
import {FakeEvm, card, input} from "../tests/fixtures";

const root = resolve(import.meta.dirname, ".."), text = (path: string) => readFile(resolve(root, path), "utf8");
const json = async (path: string) => parseStrictJson(await text(path)) as any;
const schema = await json("docs/openapi.json"), guide = await json("packages/sdk/integration.json");
const require = createRequire(resolve(root, "packages/mcp/package.json"));
const Ajv = require("ajv/dist/2020.js").default, addFormats = require("ajv-formats").default;
const ajv = new Ajv({strict: false, allErrors: true}); addFormats(ajv);
const validators = new Map<string, any>();
function validator(name: string) {
  if (!validators.has(name)) validators.set(name, ajv.compile({components: schema.components, $ref: "#/components/schemas/" + name}));
  return validators.get(name);
}
function conforms(name: string, value: unknown) { const check = validator(name); assert.equal(check(value), true, name + ": " + JSON.stringify(check.errors)); }
function refuses(name: string, value: unknown) { assert.equal(validator(name)(value), false, "Negative control accepted by " + name); }
for (const name of Object.keys(schema.components.schemas)) validator(name);
assert.equal(schema.openapi, "3.1.0"); assert.equal(schema.info.version, guide.protocolVersion); assert.equal(guide.version, 4);
assert.equal(schema.servers[0].url, "/api/v1"); assert.equal(schema.servers[1].url, guide.firstUse.publicApplication + "/api/v1");
const methods: Record<string, string[]> = {
  "/sandbox": ["get"], "/sandbox/session": ["post"], "/sandbox/requests": ["post"], "/sandbox/requests/{id}": ["get"],
  "/config": ["get"], "/health": ["get"], "/auth/challenge": ["post"], "/auth/login": ["post"], "/auth/session": ["get"], "/auth/logout": ["post"],
  "/owner/drafts": ["post"], "/owner/drafts/{id}": ["get"], "/owner/cards": ["get", "post"], "/owner/cards/{id}/keys": ["post", "delete"],
  "/owner/cards/{id}/reviewer": ["post"], "/owner/cards/{id}/replacement": ["get", "post"], "/owner/requests": ["get"], "/owner/requests/{id}": ["get"],
  "/me": ["get"], "/requests": ["post"], "/requests/{id}": ["get"], "/explorer/agents": ["get"], "/explorer/transactions": ["get"],
  "/explorer/transactions/{id}": ["get"], "/explorer/transactions/{id}/proof": ["get"], "/explorer/agents/{id}/card": ["get"], "/explorer/agents/{id}/card.svg": ["get"],
  "/demo/invoices": ["post"], "/demo/invoices/{id}": ["get"],
};
assert.deepEqual(Object.keys(schema.paths).sort(), Object.keys(methods).sort());
const operationIds = new Set<string>();
for (const [path, expected] of Object.entries(methods)) {
  assert.deepEqual(Object.keys(schema.paths[path]).sort(), [...expected].sort());
  for (const method of expected) {
    const op = schema.paths[path][method]; assert.ok(op.operationId && !operationIds.has(op.operationId)); operationIds.add(op.operationId);
    assert.ok(op.responses.default && op.responses[405]); assert.ok(op.parameters.some((p: any) => p.name === "X-IntentGuard-Environment"));
    if (path.startsWith("/owner/")) for (const name of ["OwnerSession", "OwnerBearer"]) assert.ok(op.security.some((v: any) => name in v));
    if (guide.authorization.public.paths.includes(path)) assert.deepEqual(op.security, []);
  }
}
assert.equal(schema.components.securitySchemes.AgentKey.scheme, "bearer");
assert.equal(schema.components.securitySchemes.OwnerSession.name, "ig_session");
assert.equal(schema.components.securitySchemes.OwnerBearer.name, "Authorization");
assert.equal(schema.components.securitySchemes.SandboxVisitor.name,"Authorization");
assert.deepEqual(schema.paths["/sandbox"].get.security,[]);
assert.deepEqual(schema.paths["/sandbox/session"].post.security,[]);
for(const path of ["/sandbox/requests","/sandbox/requests/{id}"])for(const operation of Object.values(schema.paths[path]) as any[])assert.deepEqual(operation.security,[{SandboxVisitor:[]}]);
for(const scenario of ["permitted","blocked","prohibited","wrong-buyer"])conforms("SandboxRequestInput",{scenario});
refuses("SandboxRequestInput",{scenario:"permitted",amount:"1"});refuses("SandboxRequestInput",{scenario:"arbitrary"});
assert.ok(schema.paths["/requests"].post.parameters.some((p: any) => p.name === "Idempotency-Key" && p.required));
assert.deepEqual(schema.components.schemas.RequestView.properties.status.enum, REQUEST_STATES);
assert.deepEqual(schema.components.schemas.PublicTransaction.properties.status.enum, REQUEST_STATES);
assert.deepEqual(schema.components.schemas.ReviewStage.properties.status.enum, ["PENDING", "COMPLETE", "SKIPPED", "FAILED"]);
assert.deepEqual(guide.requests.terminalStates, TERMINAL_STATES);
assert.deepEqual(guide.requests.pendingStates, REQUEST_STATES.filter(s => !TERMINAL_STATES.includes(s)));
for (const field of guide.client.configIdentityFields) assert.ok(schema.components.schemas.Config.properties[field], "Missing config identity " + field);
assert.deepEqual(schema.components.schemas.SettlementV2.required, guide.settlement.v2RequiredFields);
assert.equal(schema.components.schemas.ReviewerProfileV4.properties.version.const, guide.review.versionForSettlementV2);
assert.equal(guide.review.environment, "testnet"); assert.equal(guide.review.network, "studionet"); assert.equal(guide.review.chainId, 61999);
assert.equal(guide.mcp.ownerAuthority, false); assert.equal(guide.mcp.merchantAuthority, false);

const valid = {...input, amount: "1.000001"};
conforms("Policy", card.policy); assert.equal(policySchema.safeParse(card.policy).success, true);
for (const amount of ["1", "1.000001", "0.000001", "18446744073709.551615", "18446744073709.55161", "18446744073708.999999"]) {
  const payment = {...valid, amount}; conforms("PaymentInput", payment); assert.equal(paymentSchema.safeParse(payment).success, true); validatePayment(payment);
}
for (const amount of ["0", "0.000000", "1e3", "1.0000001", "-1", "01", "18446744073709.551616", "18446744073710", "18446744073709.6"]) {
  const payment = {...valid, amount}; refuses("PaymentInput", payment); assert.equal(paymentSchema.safeParse(payment).success, false); assert.throws(() => validatePayment(payment));
}
assert.equal(parseAmount("18446744073709.551615"), (1n << 64n) - 1n);
refuses("PaymentInput", {...valid, cardId: card._id}); refuses("PaymentInput", {...valid, destinationChainId: "84532"});
for (const environment of ["testnet", "mainnet"] as const) {
  const routes = profileRoutes(environment);
  assert.deepEqual(PROFILES[environment].routes, Object.fromEntries(Object.entries(routes).map(([id, route]) => [id, {domain: route.domain, token: route.token}])));
  assert.equal(Object.keys(routes).length, 11);
  for (const chainId of Object.keys(routes).map(Number)) {
    const permission = {version: 2, paymentEnvironment: environment, asset: "USDC", destinationChainIds: [chainId]};
    conforms("SettlementV2", permission); assert.deepEqual(normalizeSettlement(permission, environment), settlementV2Schema.parse(permission));
  }
  const wrong = environment === "mainnet" ? 84532 : 8453;
  refuses("SettlementV2", {version: 2, paymentEnvironment: environment, asset: "USDC", destinationChainIds: [wrong]});
}
const legacy = {asset: "USDC", destinationChainIds: [421614, 1952, 84532]};
conforms("SettlementLegacy", legacy); assert.deepEqual(normalizeSettlement(legacy, "testnet"), settlementSchema.parse(legacy));
const localUsdt0 = {version: 2, paymentEnvironment: "mainnet", asset: "USDT0", destinationChainIds: [196]}; conforms("SettlementV2", localUsdt0);
for (const permission of [{...localUsdt0, destinationChainIds: [8453]}, {...localUsdt0, paymentEnvironment: "testnet", destinationChainIds: [1952]}, {...localUsdt0, destinationChainIds: []}, {...localUsdt0, destinationChainIds: [196, 196]}, {...localUsdt0, version: 3}]) refuses("SettlementV2", permission);

const manual = await text("docs/PROTOCOL.md"), component = await text("apps/web/components/docs.tsx");
assert.equal(docsSections.length, 22); assert.equal(new Set(docsSections.map(([, id]) => id)).size, 22);
await access(resolve(root, "apps/web/app/docs/[section]/page.tsx"));
for (const [, id] of docsSections) assert.ok(component.includes('"' + id + '":<section id="' + id + '"'), "Missing UI documentation section " + id);
for (const path of ["packages/mcp/resources/PROTOCOL.md", "skills/intentguard/references/PROTOCOL.md"]) assert.equal(await text(path), manual);
for (const path of ["packages/mcp/resources/openapi.json", "skills/intentguard/references/openapi.json"]) assert.equal(await text(path), await text("docs/openapi.json"));
for (const path of ["packages/mcp/resources/integration.json", "skills/intentguard/references/integration.json"]) assert.equal(await text(path), await text("packages/sdk/integration.json"));
for (const file of ["README.md", "docs/PROTOCOL.md", "docs/DEMO.md", "docs/COMMERCIAL.md", "skills/intentguard/SKILL.md"]) {
  const contents = await text(file);
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1]; if (/^(https?:|#|mailto:)/.test(link)) continue;
    await access(resolve(root, dirname(file), link.split("#")[0]));
  }
  for (const phrase of ["Studionet", "testnet", "Idempotency-Key"]) {
    if (file !== "docs/COMMERCIAL.md") assert.ok(contents.includes(phrase), file + " misses " + phrase);
  }
}
const skill = await text("skills/intentguard/SKILL.md"), header = skill.match(/^---\n([\s\S]*?)\n---/);
assert.ok(header); assert.match(header[1], /^name: intentguard$/m); assert.match(header[1], /^description: .{10,1024}$/m); assert.equal(skill.includes("[TODO:"), false);

// Execute actual API/auth/explorer paths with isolated records; no live RPC/database/signing worker.
const origin = "https://protocol.fixture.example", frontend = "https://frontend.protocol.fixture.example";
const account = privateKeyToAccount(("0x" + "21".repeat(32)) as `0x${string}`), fixtureOwner = account.address.toLowerCase();
const fixtureAddress = "0x" + "12".repeat(20), fixtureHash = "0x" + "13".repeat(32);
const values: Record<string, string> = {INTENTGUARD_MODE: "testnet", INTENTGUARD_PAYMENT_ENV: "testnet", XLAYER_CHAIN_ID: "1952", MONGODB_DB: "intentguard", MONGODB_URI: "memory://isolated-protocol-fixture", APP_URL: origin, FRONTEND_URL: frontend, SESSION_SECRET: "protocol-isolated-session-secret-over-32-characters", PAYMENT_TOKEN: fixtureAddress, GATEWAY_ADDRESS: fixtureAddress, ATTESTOR_ADDRESS: fixtureAddress, CARD_FACTORY_ADDRESS: fixtureAddress, TAPEOUT_PROCESSOR: fixtureAddress, TAPEOUT_BEACON: fixtureAddress, TAPEOUT_IMPLEMENTATION: fixtureAddress, TAPEOUT_CIRCUIT_ID: "1", TAPEOUT_NETLIST_HASH: fixtureHash, GENLAYER_INTERPRETER_ADDRESS: fixtureAddress, GENLAYER_NETWORK: "studionet", INTENTGUARD_RELEASE_ID: "isolated-protocol-testnet", INTENTGUARD_SOURCE_COMMIT: "a".repeat(40), DEMO_MERCHANT_ADMIN_KEY: "isolated-merchant-admin-key-over-32-characters", DEMO_MERCHANT_RECIPIENT: fixtureAddress};
const names = [...Object.keys(values), "INTENTGUARD_VERIFIED_MANIFEST", "INTENTGUARD_VERIFIED_MANIFEST_SHA256", "CCTP_CARD_FACTORY_ADDRESS"];
const prior = Object.fromEntries(names.map(name => [name, process.env[name]])); let observations = 0;
try {
  for (const name of names) delete process.env[name]; Object.assign(process.env, values);
  const store = new MemoryStore(), evm = new FakeEvm(), sourceCard = {...card, owner: fixtureOwner, chainId: 1952, paymentEnvironment: "testnet" as const, token: fixtureAddress};
  const original = evm.view.bind(evm);
  evm.view = async c => ({...await original(c), chainId: 1952, paymentEnvironment: "testnet", reviewEnvironment: "testnet", reviewNetwork: "studionet", reviewChainId: 61999, setupState: c.state, reviewerVersion: c.reviewerVersion, settlement: c.settlement}) as CardView;
  await store.create("cards", sourceCard); const apiKey = await issueKey(store, sourceCard._id, fixtureOwner), api = createApi(store, evm, {wake: () => {}});
  async function request(path: string, method = "GET", body?: unknown, authorization?: string) {
    const response = await api(new Request(origin + "/api/v1" + path, {method, headers: {"X-IntentGuard-Environment": "testnet", Origin: frontend, ...(body !== undefined ? {"Content-Type": "application/json"} : {}), ...(authorization ? {Authorization: authorization} : {}), ...(path === "/requests" ? {"Idempotency-Key": "isolated-protocol-operation"} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), new URL(origin + path).pathname);
    observations++; return {response, value: response.status === 204 || response.headers.get("content-type")?.startsWith("image/") ? undefined : await response.json()};
  }
  const configuration = await request("/config"); assert.equal(configuration.response.status, 200); conforms("Config", configuration.value);
  const health = await request("/health"); assert.equal(health.response.status, 503); conforms("Health", health.value);
  const me = await request("/me", "GET", undefined, "Bearer " + apiKey); assert.equal(me.response.status, 200); conforms("CardView", me.value.card);
  const admission = await request("/requests", "POST", valid, "Bearer " + apiKey); assert.equal(admission.response.status, 202); conforms("Admission", admission.value);
  const operation = await request("/requests/" + admission.value.id, "GET", undefined, "Bearer " + apiKey); conforms("RequestView", operation.value);
  const publicAgents = await request("/explorer/agents"); conforms("PublicAgent", publicAgents.value.agents[0]);
  const publicRecords = await request("/explorer/transactions"); conforms("PublicTransaction", publicRecords.value.transactions[0]);
  const detail = await request("/explorer/transactions/" + admission.value.id); conforms("PublicTransactionDetail", detail.value);
  const snapshot = await request("/explorer/agents/" + sourceCard._id + "/card"); conforms("AgentCardSnapshot", snapshot.value);
  const svg = await request("/explorer/agents/" + sourceCard._id + "/card.svg"); assert.equal(svg.response.status, 200); assert.match(await svg.response.text(), /Research Agent/);
  const missingProof = await request("/explorer/transactions/" + admission.value.id + "/proof"); assert.equal(missingProof.response.status, 404); conforms("Error", missingProof.value);
  for (const [path, expected] of Object.entries(methods)) {
    const actualPath = path.replaceAll("{id}", path.startsWith("/demo/invoices/") ? "a".repeat(32) : sourceCard._id);
    const unsupported = expected.includes("get") ? "PUT" : "GET", result = await request(actualPath, unsupported);
    assert.equal(result.response.status, 405, "Actual API method mismatch: " + path); conforms("Error", result.value);
    assert.deepEqual(result.response.headers.get("allow")!.split(/,\s*/).sort(), expected.map(m => m.toUpperCase()).sort());
  }
  const challenged = await request("/auth/challenge", "POST", {address: fixtureOwner}); assert.equal(challenged.response.status, 200);
  const logged = await request("/auth/login", "POST", {address: fixtureOwner, signature: await account.signMessage({message: challenged.value.message})}); assert.equal(logged.response.status, 200);
  const ownerAuth = "Owner " + logged.value.ownerSession;
  const draft = await request("/owner/drafts", "POST", {description: "Purchase verifiable research APIs for the owner mission."}, ownerAuth); assert.equal(draft.response.status, 202); conforms("Admission", draft.value);
  const proposal = await request("/owner/drafts/" + draft.value.id, "GET", undefined, ownerAuth); conforms("DraftView", proposal.value);
  const cards = await request("/owner/cards", "GET", undefined, ownerAuth); conforms("CardView", cards.value.cards[0]);
  const requests = await request("/owner/requests", "GET", undefined, ownerAuth); conforms("RequestView", requests.value.requests[0]);
  const merchant = await request("/demo/invoices", "POST", {buyer: sourceCard.address, amount: "1.000001", description: "Actual isolated protocol invoice"}, "Bearer " + values.DEMO_MERCHANT_ADMIN_KEY); assert.equal(merchant.response.status, 201); conforms("DemoInvoice", merchant.value.invoice);
  const invoice = await request("/demo/invoices/" + merchant.value.invoice.invoiceId); conforms("DemoInvoice", invoice.value);
  const unauthorized = await request("/me"); assert.equal(unauthorized.response.status, 401); conforms("Error", unauthorized.value);
  Object.assign(process.env, {INTENTGUARD_MODE: "mainnet", INTENTGUARD_PAYMENT_ENV: "mainnet", XLAYER_CHAIN_ID: "196", MONGODB_DB: "intentguard_mainnet", PAYMENT_TOKEN: USDT0_MAINNET, ATTESTOR_ADDRESS: "0x" + "14".repeat(20)});
  const mainnetResponse = await api(new Request(origin + "/api/v1/config"), "/config"), mainnet = await mainnetResponse.json(); observations++;
  conforms("Config", mainnet); assert.equal(mainnet.paymentEnvironment, "mainnet"); assert.equal(mainnet.configured, false); assert.equal(mainnet.settlementVersion, 2); assert.deepEqual(mainnet.spendingNetworks, []);
  refuses("Config", {...mainnet, chainId: 1952}); refuses("Config", {...mainnet, reviewEnvironment: "mainnet"});
} finally { for (const [name, value] of Object.entries(prior)) if (value === undefined) delete process.env[name]; else process.env[name] = value; }

const live = await json("docs/audits/cctp-live-results.json"), independent = await json("docs/audits/cctp-independent.json");
assert.equal(live.kind, "LIVE_TESTNET_CCTP_API_AUDIT"); assert.equal(live.status, "PASSED"); assert.equal(live.sourceChainId, 1952); assert.equal(independent.allPassed, true);
const hashFile = async (path: string) => createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
const measurements = guide.commercial.measurements;
assert.equal(measurements.sourceSha256, await hashFile(measurements.source)); assert.equal(measurements.independentAuditSha256, await hashFile(measurements.independentAudit));
const recomputed = live.cases.filter((c: any) => c.result && ["PAID", "BLOCKED", "REJECTED", "NEEDS_EVIDENCE"].includes(c.result.status)).map((c: any) => ({name: c.name, requestId: c.requestId, status: c.result.status, createdAt: c.result.createdAt, updatedAt: c.result.updatedAt, elapsedMs: c.result.updatedAt - c.result.createdAt, sourceChainId: 1952, destinationChainId: c.payload.destinationChainId ?? 1952, amount: c.result.request.amount, failedAttemptCount: c.failedAttempts?.length ?? 0}));
assert.deepEqual(measurements.records, recomputed); assert.ok(recomputed.every((v: any) => v.elapsedMs >= 0));
assert.equal(measurements.independentCases, independent.cases.length); assert.equal(measurements.verifiedIndependentCases, independent.cases.filter((c: any) => c.verified).length); assert.equal(measurements.deliveredPayments, independent.cases.filter((c: any) => c.status === "PAID").length);
for (const record of guide.firstUse.records) { const actual = independent.cases.find((c: any) => c.requestId === record.requestId && c.name === record.name); assert.ok(actual && actual.verified); for (const field of ["status", "sourceChainId", "destinationChainId"]) assert.equal(record[field], actual[field]); }
const commercial = await text("docs/COMMERCIAL.md"), demo = await text("docs/DEMO.md");
for (const record of recomputed) assert.ok(commercial.includes((record.elapsedMs / 1000).toFixed(3)), "Missing measured historical latency");
const price = guide.commercial.pricingHypothesis;
assert.equal(price.costInputsAreMeasured, false); assert.equal(price.feeImplemented, false); assert.equal(measurements.testnetAssetsHaveMonetaryValue, false);
const costs = price.monthlyIncludedPayments * (price.assumedCostPerPaymentGas + price.assumedCostPerPaymentReview) + price.assumedMonthlyInfrastructure + price.assumedMonthlySupport;
const contribution = price.monthlyTeamPlan - costs, margin = 100 * contribution / price.monthlyTeamPlan, breakEven = (price.monthlyTeamPlan - price.assumedMonthlyInfrastructure - price.assumedMonthlySupport) / (price.assumedCostPerPaymentGas + price.assumedCostPerPaymentReview);
for (const number of [price.monthlyTeamPlan, costs, contribution, breakEven, margin.toFixed(4)]) assert.ok(commercial.includes(String(number)), "Missing computed pricing assumption " + number);
assert.equal(guide.commercial.customerStudy.status, "NOT_STARTED"); assert.equal(guide.commercial.customerStudy.outreachSent, false);
assert.equal(guide.externalEvidence.interviews, "NOT_CONDUCTED"); assert.equal(guide.externalEvidence.pilots, "NOT_STARTED"); assert.equal(guide.externalEvidence.willingnessToPay, "NOT_MEASURED"); assert.equal(guide.externalEvidence.submissionVideo, "NOT_RECORDED");
assert.equal(guide.demo.status, "NOT_RECORDED"); assert.equal(guide.demo.mainnetClaims, false); assert.equal(guide.demo.freshPaymentsShown, false);
let end = 0;
for (const segment of guide.demo.segments) { assert.equal(segment.startSeconds, end); assert.ok(segment.endSeconds > end); end = segment.endSeconds; for (const name of segment.recordNames ?? []) { const record = guide.firstUse.records.find((r: any) => r.name === name); assert.ok(record && demo.includes(record.requestId)); } }
assert.equal(end, guide.demo.durationSeconds); assert.ok(end <= 180); assert.ok(demo.includes(String(end))); assert.ok(demo.includes("NOT_RECORDED")); assert.ok(commercial.includes("PREPARATION_NOT_CUSTOMER_VALIDATED"));
const pkg = await json("packages/mcp/package.json"), lock = await json("packages/mcp/package-lock.json"); assert.equal(pkg.version, schema.info.version); assert.equal(lock.version, pkg.version); assert.deepEqual(lock.packages[""].engines, pkg.engines); assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
console.log(JSON.stringify({schemaVersion: schema.info.version, schemas: validators.size, apiObservations: observations, independentCases: measurements.independentCases, deliveredTestnetPayments: measurements.deliveredPayments, historicalLatencies: recomputed.map((r: any) => ({name: r.name, elapsedMs: r.elapsedMs})), demoPlannedSeconds: end, mainnetAcceptance: false, customerValidation: false, recordedVideo: false}));
console.log("Protocol documentation verification passed");
