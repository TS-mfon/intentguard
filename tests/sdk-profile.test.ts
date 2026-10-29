import test from "node:test";
import assert from "node:assert/strict";
import {IntentGuard, IntentGuardOwner, IntentGuardError, commitment, normalizeSettlement, validatePayment} from "../packages/sdk";
import {privateKeyToAccount} from "viem/accounts";
import {PROFILES} from "../packages/sdk/client.mjs";
import {digest, settlementV2Schema, settlementSchema, paymentSchema, type CardView} from "../packages/shared";
import {profileRoutes} from "../packages/shared/payment-profiles";
import {createApi} from "../apps/web/lib/api";
import {MemoryStore} from "../apps/web/lib/store";
import {issueKey} from "../apps/web/lib/auth";
import {publicDeploymentConfiguration} from "../apps/web/lib/capabilities";
import {FakeEvm, card, input, owner} from "./fixtures";

const base = "https://sdk.testnet.example", key = "ig_" + "a".repeat(43), mainnetKey = "ig_mainnet_" + "b".repeat(43);
const address = "0x" + "12".repeat(20), otherId = "0x" + "ab".repeat(32);
const envValues = {
  INTENTGUARD_MODE: "testnet", INTENTGUARD_PAYMENT_ENV: "testnet", XLAYER_CHAIN_ID: "1952", MONGODB_DB: "intentguard",
  MONGODB_URI: "mongodb://fixture.invalid/intentguard", APP_URL: base, FRONTEND_URL: base,
  SESSION_SECRET: "sdk-controlled-session-secret-over-32-characters", PAYMENT_TOKEN: address,
  GATEWAY_ADDRESS: "0x" + "10".repeat(20), ATTESTOR_ADDRESS: "0x" + "11".repeat(20), CARD_FACTORY_ADDRESS: address,
  TAPEOUT_PROCESSOR: address, TAPEOUT_BEACON: address, TAPEOUT_IMPLEMENTATION: address,
  TAPEOUT_CIRCUIT_ID: "1", TAPEOUT_NETLIST_HASH: "0x" + "13".repeat(32), GENLAYER_INTERPRETER_ADDRESS: address,
  GENLAYER_NETWORK: "studionet", INTENTGUARD_RELEASE_ID: "controlled-testnet-release", INTENTGUARD_SOURCE_COMMIT: "a".repeat(40),
};
const envNames = [...Object.keys(envValues), "INTENTGUARD_VERIFIED_MANIFEST", "INTENTGUARD_VERIFIED_MANIFEST_SHA256", "CCTP_CARD_FACTORY_ADDRESS"];
async function fixture(run: (f: {store: MemoryStore; api: ReturnType<typeof createApi>; apiKey: string; config: any; view: CardView; seen: {path: string; init: RequestInit}[]; fetchImpl: typeof fetch}) => Promise<void>) {
  const prior = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
  try {
    for (const k of envNames) delete process.env[k]; Object.assign(process.env, envValues);
    const store = new MemoryStore(), evm = new FakeEvm(), sourceCard = {...card, chainId: 1952, token: address, paymentEnvironment: "testnet" as const};
    const originalView = evm.view.bind(evm);
    evm.view = async c => ({...await originalView(c), chainId: Number(c.chainId), paymentEnvironment: "testnet", reviewEnvironment: "testnet", reviewNetwork: "studionet", reviewChainId: 61999, reviewerVersion: c.reviewerVersion, settlement: c.settlement, setupState: c.state});
    await store.create("cards", sourceCard); const apiKey = await issueKey(store, card._id, owner);
    const api = createApi(store, evm, {wake: () => {}}), seen: {path: string; init: RequestInit}[] = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => { const u = new URL(String(url)); seen.push({path: u.pathname + u.search, init}); return api(new Request(url, init), u.pathname.replace("/api/v1", "")); };
    await run({store, api, apiKey, config: await publicDeploymentConfiguration(), view: await evm.view(sourceCard), seen, fetchImpl});
  } finally { for (const [k, v] of Object.entries(prior)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
function expectedError(code: string, status?: number) { return (e: unknown) => { assert.ok(e instanceof IntentGuardError); assert.equal(e.code, code); if (status !== undefined) assert.equal(e.status, status); return true; }; }

test("SDK verifies real API identity anonymously and admits one card-scoped operation", () => fixture(async f => {
  assert.equal(f.config.configured, true);
  const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: f.apiKey, expectedCardId: card._id, fetchImpl: f.fetchImpl});
  assert.equal((await ig.capabilities()).paymentEnvironment, "testnet");
  assert.equal(new Headers(f.seen.at(-1)!.init.headers).get("Authorization"), null);
  await ig.listAgents({limit: 1}); assert.equal(new Headers(f.seen.at(-1)!.init.headers).get("Authorization"), null);
  f.seen.length = 0;
  const first = await ig.request(input, "stable-sdk-operation");
  assert.deepEqual(f.seen.map(x => x.path), ["/api/v1/config", "/api/v1/me", "/api/v1/requests"]);
  assert.equal(new Headers(f.seen[0].init.headers).get("Authorization"), null);
  assert.equal(new Headers(f.seen[1].init.headers).get("Authorization"), "Bearer " + f.apiKey);
  assert.equal(new Headers(f.seen[2].init.headers).get("Idempotency-Key"), "stable-sdk-operation");
  assert.equal(new Headers(f.seen[2].init.headers).get("X-IntentGuard-Environment"), "testnet");
  assert.equal(f.seen[2].init.credentials, "omit"); assert.equal(f.seen[2].init.redirect, "error");
  assert.equal(first.id, digest({cardId: card._id, idempotency: "stable-sdk-operation"})); assert.equal(first.status, "QUEUED");
  assert.deepEqual(await ig.request(input, "stable-sdk-operation"), first);
  assert.equal((await f.store.find("requests", {})).length, 1);
  await assert.rejects(ig.request({...input, amount: "6"}, "stable-sdk-operation"), expectedError("IDEMPOTENCY_CONFLICT", 409));
  await f.store.patch("requests", first.id, {status: "BLOCKED"});
  assert.equal((await ig.wait(first.id, {timeoutMs: 0})).status, "BLOCKED");
  assert.equal(JSON.stringify(ig).includes(f.apiKey), false);
}));

test("cross-environment, API, frontend, reviewer and release mismatches send no credential", () => fixture(async f => {
  const cases: [any, string][] = [
    [{paymentEnvironment: "mainnet"}, "PAYMENT_ENVIRONMENT_MISMATCH"], [{chainId: 196}, "PAYMENT_ENVIRONMENT_MISMATCH"],
    [{apiOrigin: "https://other.example"}, "API_IDENTITY_MISMATCH"], [{frontendOrigin: "https://other.example"}, "FRONTEND_IDENTITY_MISMATCH"],
    [{ownerSessionTransport: "owner-bearer"}, "FRONTEND_IDENTITY_MISMATCH"], [{reviewEnvironment: "mainnet"}, "REVIEW_IDENTITY_MISMATCH"],
    [{reviewChainId: 4221}, "REVIEW_IDENTITY_MISMATCH"], [{reviewNetwork: "bradbury"}, "REVIEW_IDENTITY_MISMATCH"],
    [{releaseId: "different"}, "RELEASE_IDENTITY_MISMATCH"], [{sourceCommit: "b".repeat(40)}, "RELEASE_IDENTITY_MISMATCH"],
  ];
  for (const [change, code] of cases) {
    const seen: RequestInit[] = [], fetchImpl: typeof fetch = async (_u, init = {}) => { seen.push(init); return Response.json({...f.config, ...change}); };
    const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, expectedReleaseId: f.config.releaseId, expectedSourceCommit: f.config.sourceCommit, fetchImpl});
    await assert.rejects(ig.request(input, "stable"), expectedError(code, 409)); assert.equal(seen.length, 1);
    assert.equal(new Headers(seen[0].headers).get("Authorization"), null);
  }
  for (const [paymentEnvironment, apiKey] of [["testnet", mainnetKey], ["mainnet", key]] as const) {
    let calls = 0; const ig = new IntentGuard({baseUrl: base, paymentEnvironment, apiKey, fetchImpl: async () => { calls++; throw Error(); }});
    await assert.rejects(ig.me(), expectedError("CREDENTIAL_ENVIRONMENT_MISMATCH", 409)); assert.equal(calls, 0);
  }
}));

test("credential-bound card and V4 mismatches stop before payment admission", () => fixture(async f => {
  const v2 = {version: 2, paymentEnvironment: "testnet", asset: "USDC", destinationChainIds: [1952]};
  for (const change of [{chainId: 196}, {paymentEnvironment: "mainnet"}, {id: otherId}, {policyHash: otherId},
    {token: PROFILES.mainnet.sourceUSDC}, {settlement: v2, token: PROFILES.testnet.sourceUSDC, reviewerVersion: 3}]) {
    const seen: string[] = []; const fetchImpl: typeof fetch = async (u) => { const path = new URL(String(u)).pathname; seen.push(path); return Response.json(path.endsWith("/config") ? f.config : {card: {...f.view, ...change}}); };
    const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, expectedCardId: card._id, fetchImpl});
    await assert.rejects(ig.request(input, "stable"), (e: unknown) => { assert.ok(e instanceof IntentGuardError); assert.ok(["CARD_IDENTITY_MISMATCH", "REVIEW_IDENTITY_MISMATCH", "ASSET_CONFIGURATION_MISMATCH"].includes(e.code)); return true; });
    assert.deepEqual(seen, ["/api/v1/config", "/api/v1/me"]);
  }
}));

test("unready configurations and old hosted schemas remain public but cannot receive credentials", () => fixture(async f => {
  let calls = 0; const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, fetchImpl: async () => { calls++; return Response.json({...f.config, configured: false, readinessReasons: ["DEPLOYMENT_NOT_VERIFIED"]}); }});
  assert.equal((await ig.capabilities()).configured, false);
  await assert.rejects(ig.me(), expectedError("DEPLOYMENT_NOT_READY", 503)); assert.equal(calls, 2);
  const old = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, fetchImpl: async () => Response.json({mode: "testnet", chainId: 1952, configured: true})});
  await assert.rejects(old.me(), expectedError("PAYMENT_ENVIRONMENT_MISMATCH", 409));
}));

test("mainnet V2 settlement and V4 review work without enabling an unverified route", () => fixture(async f => {
  const origin = "https://sdk.mainnet.example", pins = PROFILES.mainnet;
  const config = {...f.config, mode: "mainnet", paymentEnvironment: "mainnet", chainId: 196, apiOrigin: origin, frontendOrigin: origin, applicationUrl: origin, token: pins.usdt0, settlementVersion: 2,
    assets: [{asset: "USDC", available: true, chainId: 196, decimals: 6, token: pins.sourceUSDC}, {asset: "USDT0", available: true, chainId: 196, decimals: 6, token: pins.usdt0}],
    spendingNetworks: [196, 8453].map(chainId => ({chainId, ...pins.routes[chainId]}))};
  let posted = 0;
  const view = {...f.view, chainId: 196, paymentEnvironment: "mainnet", token: pins.sourceUSDC, reviewerVersion: 4, settlement: {version: 2, paymentEnvironment: "mainnet", asset: "USDC", destinationChainIds: [196, 8453]}};
  const fetchImpl: typeof fetch = async (u, init = {}) => { const path = new URL(String(u)).pathname; if (path.endsWith("/config")) { assert.equal(new Headers(init.headers).get("Authorization"), null); return Response.json(config); } if (path.endsWith("/me")) return Response.json({card: view}); posted++; return Response.json({id: card._id, status: "QUEUED"}, {status: 202}); };
  const ig = new IntentGuard({baseUrl: origin, paymentEnvironment: "mainnet", apiKey: mainnetKey, fetchImpl});
  assert.equal((await ig.request({...input, destinationChainId: 8453}, "mainnet-fixture")).status, "QUEUED"); assert.equal(posted, 1);
  await assert.rejects(ig.request({...input, destinationChainId: 84532}, "wrong-env"), expectedError("DESTINATION_NOT_ALLOWED", 422)); assert.equal(posted, 1);
  config.spendingNetworks = config.spendingNetworks.slice(0, 1);
  await assert.rejects(ig.request({...input, destinationChainId: 8453}, "not-verified"), expectedError("ASSET_OR_ROUTE_NOT_VERIFIED", 503)); assert.equal(posted, 1);
}));

test("stable HTTP errors preserve status, correlation, retry advice and redacted details", async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 503]) {
    const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, fetchImpl: async () => Response.json({error: {code: "CONTROLLED_" + status, message: "Denied " + key, retryable: status === 429 || status === 503, requestId: "correlation", details: [{field: "controlled", message: key}]}}, {status, headers: {"Retry-After": "9"}})});
    await assert.rejects(ig.listAgents(), (e: unknown) => { assert.ok(e instanceof IntentGuardError); assert.equal(e.status, status); assert.equal(e.code, "CONTROLLED_" + status); assert.equal(e.requestId, "correlation"); assert.equal(e.retryAfterSeconds, 9); assert.equal(e.retryable, status === 429 || status === 503); assert.equal(JSON.stringify(e).includes(key), false); assert.equal(e.message.includes(key), false); return true; });
  }
  const down = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", fetchImpl: async () => { throw Error("secret transport details"); }});
  await assert.rejects(down.listAgents(), expectedError("TRANSPORT_UNAVAILABLE", 0));
  const html = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", fetchImpl: async () => new Response("<html>offline</html>", {status: 503})});
  await assert.rejects(html.listAgents(), expectedError("INVALID_RESPONSE", 503));
});

test("SDK pins and commitment formats match the server while malformed input never reaches HTTP", async () => {
  for (const environment of ["testnet", "mainnet"] as const) {
    assert.deepEqual(PROFILES[environment].routes, Object.fromEntries(Object.entries(profileRoutes(environment)).map(([id, r]) => [id, {domain: r.domain, token: r.token}])));
    const settlement = {version: 2, paymentEnvironment: environment, asset: "USDC", destinationChainIds: [PROFILES[environment].sourceChainId]};
    assert.deepEqual(normalizeSettlement(settlement, environment), settlementV2Schema.parse(settlement));
  }
  assert.equal(await commitment(card.policy), digest(card.policy));
  assert.deepEqual(normalizeSettlement({asset: "USDC", destinationChainIds: [421614, 1952]}, "testnet"), settlementSchema.parse({asset: "USDC", destinationChainIds: [421614, 1952]}));
  assert.equal(paymentSchema.safeParse(input).success, true); validatePayment(input);
  let calls = 0; const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, fetchImpl: async () => { calls++; throw Error(); }});
  for (const payment of [{...input, amount: "0"}, {...input, amount: "1e3"}, {...input, amount: "18446744073709.551616"}, {...input, amount: "1.0000001"}, {...input, cardId: card._id}, {...input, evidence: [input.evidence[0], input.evidence[0]]}, {...input, evidence: [{url: "https://127.0.0.1/invoice"}]}]) await assert.rejects(ig.request(payment, "stable"), expectedError("INVALID_INPUT", 422));
  assert.equal(calls, 0);
  for (const baseUrl of ["http://remote.example", "https://user:secret@example.com", "https://example.com/path", "https://example.com/?key=x"]) assert.throws(() => new IntentGuard({baseUrl, paymentEnvironment: "testnet"}), expectedError("INVALID_INPUT", 422));
  assert.throws(() => new IntentGuard({baseUrl: base} as any), expectedError("INVALID_INPUT", 422));
});

test("owner transport uses memory-only Owner tokens, verifies challenge identity and never accepts an agent key", () => fixture(async f => {
  const frontend = "https://frontend.sdk.example"; process.env.FRONTEND_URL = frontend;
  const account = privateKeyToAccount(("0x" + "21".repeat(32)) as `0x${string}`);
  const sdk = new IntentGuardOwner({baseUrl: base, paymentEnvironment: "testnet", frontendOrigin: frontend, fetchImpl: f.fetchImpl});
  const {message} = await sdk.challenge(account.address);
  assert.match(message, /Payment environment: testnet/); assert.ok(message.includes("URI: " + frontend));
  const logged = await sdk.login(account.address, await account.signMessage({message}));
  assert.equal(logged.transport, "owner-bearer"); assert.ok(logged.expiresAt! <= Date.now() + 600000);
  assert.equal("ownerSession" in logged, false);
  assert.deepEqual(await sdk.listCards(), {cards: []});
  assert.match(new Headers(f.seen.at(-1)!.init.headers).get("Authorization")!, /^Owner /);
  assert.equal(f.seen.at(-1)!.init.credentials, "omit"); assert.equal(f.seen.at(-1)!.init.method, "GET");
  assert.equal(new Headers(f.seen.at(-2)!.init.headers).get("Authorization"), null);
  assert.equal(new Headers(f.seen.at(-1)!.init.headers).get("Origin"), frontend);
  assert.equal(JSON.stringify(sdk).includes("Owner"), false);
  await sdk.logout(); assert.equal(f.seen.at(-2)!.init.method, "GET", "logout preflight stays anonymous GET");
  await assert.rejects(sdk.listCards(), expectedError("LOGIN_REQUIRED", 401));
  const wrong = new IntentGuardOwner({baseUrl: base, paymentEnvironment: "testnet", frontendOrigin: frontend, fetchImpl: async () => Response.json({...f.config, frontendOrigin: frontend, applicationUrl: frontend, ownerSessionTransport: "owner-bearer"})});
  await assert.rejects(wrong.challenge(account.address), expectedError("CHALLENGE_IDENTITY_MISMATCH", 409));
  assert.throws(() => new IntentGuardOwner({baseUrl: base, paymentEnvironment: "testnet", apiKey: key} as any), expectedError("INVALID_INPUT", 422));
}));

test("malformed capability rows are typed failures and never receive a credential", () => fixture(async f => {
  for (const change of [{assets: [null]}, {spendingNetworks: [null]}]) {
    const seen: RequestInit[] = [], ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, fetchImpl: async (_url, init = {}) => {seen.push(init); return Response.json({...f.config, ...change});}});
    await assert.rejects(ig.me(), expectedError("INVALID_RESPONSE", 502));
    assert.equal(seen.length, 1); assert.equal(new Headers(seen[0].headers).get("Authorization"), null);
  }
}));

test("public bridge proofs bind canonical bytes and explicit request environment asset and destination", async () => {
  const proof = {version: 1, requestId: card._id, paymentEnvironment: "testnet", reviewEnvironment: "testnet", reviewNetwork: "studionet", sourceChainId: 1952, destinationChainId: 84532, destinationDomain: 6, sourceToken: PROFILES.testnet.sourceUSDC, destinationToken: PROFILES.testnet.routes[84532].token, sourceReceipt: {}, originalMessage: "0x1234", trustBoundary: "Isolated proof fixture; not live delivery evidence"};
  let data: any = {id: card._id, proof, proofHash: await commitment(proof), verification: "Isolated fixture"};
  const seen: RequestInit[] = [], ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: key, fetchImpl: async (_url, init = {}) => {seen.push(init); return Response.json(data);}});
  assert.equal((await ig.getBridgeProof(card._id)).proofHash, data.proofHash);
  data = {...data, proof: {...proof, originalMessage: "0x9999"}};
  await assert.rejects(ig.getBridgeProof(card._id), expectedError("PROOF_IDENTITY_MISMATCH", 409));
  for (const change of [{requestId: otherId}, {paymentEnvironment: "mainnet"}, {sourceChainId: 196}, {destinationChainId: 8453}, {destinationDomain: 3}, {sourceToken: PROFILES.mainnet.sourceUSDC}, {reviewEnvironment: "mainnet"}]) {
    const changed = {...proof, ...change}; data = {id: card._id, proof: changed, proofHash: await commitment(changed), verification: "Isolated fixture"};
    await assert.rejects(ig.getBridgeProof(card._id), expectedError("PROOF_IDENTITY_MISMATCH", 409));
  }
  assert.ok(seen.every(init => new Headers(init.headers).get("Authorization") === null && init.credentials === "omit"));
});

test("bounded polling preserves the same pending operation and never submits a second payment", () => fixture(async f => {
  const ig = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: f.apiKey, fetchImpl: f.fetchImpl});
  const admitted = await ig.request(input, "bounded-poll-operation"); await f.store.patch("requests", admitted.id, {status: "MINTING"}); f.seen.length = 0;
  await assert.rejects(ig.wait(admitted.id, {timeoutMs: 150, intervalMs: 100}), (e: unknown) => {assert.ok(e instanceof IntentGuardError); assert.equal(e.code, "POLL_TIMEOUT"); assert.deepEqual(e.details, {operationId: admitted.id, lastStatus: "MINTING"}); return true;});
  assert.ok(f.seen.every(v => v.init.method === "GET")); assert.equal((await f.store.find("requests", {})).length, 1);
  await f.store.patch("requests", admitted.id, {status: "BLOCKED"}); assert.equal((await ig.wait(admitted.id, {timeoutMs: 0})).status, "BLOCKED");
  const abort = new AbortController(); abort.abort();
  const respectingFetch: typeof fetch = (url, init) => {init?.signal?.throwIfAborted(); return f.fetchImpl(url, init);};
  const stopped = new IntentGuard({baseUrl: base, paymentEnvironment: "testnet", apiKey: f.apiKey, fetchImpl: respectingFetch});
  await assert.rejects(stopped.wait(admitted.id, {signal: abort.signal}), expectedError("ABORTED", 0));
  assert.equal((await f.store.find("requests", {})).length, 1);
}));
