/** Browser-safe protocol runtime shared by the TypeScript SDK and the MCP server. */
export class IntentGuardError extends Error {
  constructor(message, status, code, retryable, requestId, retryAfterSeconds, details) {
    super(message); this.name = "IntentGuardError";
    Object.assign(this, {status, code, retryable, requestId, retryAfterSeconds, details});
  }
}
export const REQUEST_STATES = Object.freeze(["QUEUED", "RESERVED", "REVIEWING", "AWAITING_FINALITY", "APPROVED", "PAID", "BLOCKED", "REJECTED", "NEEDS_EVIDENCE", "EXPIRED", "CANCELLED", "RETRYING", "BRIDGING", "AWAITING_ATTESTATION", "MINTING"]);
export const TERMINAL_STATES = Object.freeze(["PAID", "BLOCKED", "REJECTED", "NEEDS_EVIDENCE", "EXPIRED", "CANCELLED"]);
const hash = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const nonzeroAddress = v => typeof v === "string" && address.test(v) && !/^0x0{40}$/.test(v);
const error = (code, message, status = 409, retryable = false, details) => new IntentGuardError(message, status, code, retryable, undefined, undefined, details);
const invalid = message => error("INVALID_INPUT", message, 422);
const route = (domain, token) => Object.freeze({domain, token});
// These are issuer identity pins, not enabled capabilities. /config decides availability.
export const PROFILES = Object.freeze({
  testnet: Object.freeze({sourceChainId: 1952, sourceUSDC: "0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3", usdt0: null, routes: Object.freeze({
    1952: route(37, "0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3"), 84532: route(6, "0x036cbd53842c5426634e7929541ec2318f3dcf7e"),
    421614: route(3, "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d"), 11155420: route(2, "0x5fd84259d66cd46123540766be93dfe6d43130d7"),
    11155111: route(0, "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"), 80002: route(7, "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582"),
    43113: route(1, "0x5425890298aed601595a70ab815c96711a31bc65"), 1301: route(10, "0x31d0220469e10c4e71834a79b1f276d740d3768f"),
    59141: route(11, "0xfece4462d57bd51a6a552365a011b95f0e16d9b7"), 4801: route(14, "0x66145f38cbac35ca6f1dfb4914df98f1614aea88"),
    998: route(19, "0x2b3370ee501b4a559b57d449569354196457d8ab"),
  })}),
  mainnet: Object.freeze({sourceChainId: 196, sourceUSDC: "0xb6ceceab302e2e4948951ee7843fc24e92933061", usdt0: "0x779ded0c9e1022225f8e0630b35a9b54be713736", routes: Object.freeze({
    196: route(37, "0xb6ceceab302e2e4948951ee7843fc24e92933061"), 8453: route(6, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    42161: route(3, "0xaf88d065e77c8cc2239327c5edb3a432268e5831"), 10: route(2, "0x0b2c639c533813f4aa9d7837caf62653d097ff85"),
    1: route(0, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), 137: route(7, "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"),
    43114: route(1, "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e"), 130: route(10, "0x078d782b760474a361dda0af3839290b0ef57ad6"),
    59144: route(11, "0x176211869ca2b568f2a7d4ee941e073a821ee1ff"), 480: route(14, "0x79a02482a880bce3f13e09da970dc34db4cd24d1"),
    999: route(19, "0xb88339cb7199b77e23db6e890353e22632ba630f"),
  })}),
});
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}
export async function commitment(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return "0x" + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
function safeOrigin(value, label) {
  let u;
  try { if (typeof value !== "string" || value !== value.trim()) throw Error(); u = new URL(value); } catch { throw invalid(label + " must be an explicit application origin."); }
  if (u.username || u.password || u.search || u.hash || !["", "/"].includes(u.pathname) ||
    (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))))
    throw invalid(label + " must use HTTPS without credentials, path, query or fragment; loopback HTTP is allowed for development.");
  return u.origin;
}
function optionsFor(options) {
  if (!record(options) || !["local", "testnet", "mainnet"].includes(options.paymentEnvironment)) throw invalid("Choose an explicit paymentEnvironment: local, testnet or mainnet.");
  const baseUrl = safeOrigin(options.baseUrl, "baseUrl"), frontendOrigin = safeOrigin(options.frontendOrigin ?? baseUrl, "frontendOrigin");
  const sourceChainId = options.paymentEnvironment === "local" ? options.sourceChainId ?? 31337 : PROFILES[options.paymentEnvironment].sourceChainId;
  if (!Number.isSafeInteger(sourceChainId) || sourceChainId < 1 || (options.sourceChainId !== undefined && options.sourceChainId !== sourceChainId)) throw invalid("sourceChainId must match the selected payment environment.");
  if (options.expectedSourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(options.expectedSourceCommit)) throw invalid("expectedSourceCommit must be a full lowercase source commit.");
  if (options.expectedReleaseId !== undefined && (typeof options.expectedReleaseId !== "string" || !options.expectedReleaseId.trim())) throw invalid("expectedReleaseId must be nonempty.");
  if (options.expectedCardId !== undefined && !hash.test(options.expectedCardId)) throw invalid("expectedCardId must be a 32-byte hex identifier.");
  const requestTimeoutMs = options.requestTimeoutMs ?? 20000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60000) throw invalid("requestTimeoutMs must be between 1 and 60000.");
  return Object.freeze({baseUrl, frontendOrigin, sourceChainId, paymentEnvironment: options.paymentEnvironment, expectedReleaseId: options.expectedReleaseId, expectedSourceCommit: options.expectedSourceCommit, expectedCardId: options.expectedCardId, requestTimeoutMs});
}
function assertKey(key, environment) {
  if (!key) throw error("KEY_REQUIRED", "Configure the owner-issued agent key; public requests do not require it.", 401);
  if (typeof key !== "string" || key.length > 256 || !/^ig_[A-Za-z0-9_-]+$/.test(key)) throw error("KEY_INVALID", "Use an agent API key, separate from owner sessions and merchant credentials.", 401);
  if ((environment === "mainnet") !== key.startsWith("ig_mainnet_")) throw error("CREDENTIAL_ENVIRONMENT_MISMATCH", "The credential prefix belongs to a different payment environment.");
}
function amountAtomic(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw invalid("Use an exact decimal amount with at most six fractional digits.");
  const [a, b = ""] = value.split("."), n = BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
  if (n > 18446744073709551615n) throw invalid("The amount exceeds uint64 atomic units.");
  return n;
}
function evidenceUrl(value) {
  let u; try { u = new URL(value); } catch { return false; }
  return typeof value === "string" && value.length <= 2048 && u.protocol === "https:" && !u.username && !u.password && !u.hash && (!u.port || u.port === "443") &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(u.hostname) && u.hostname.includes(".") && !/^[0-9.]+$/.test(u.hostname) && !u.hostname.endsWith(".") && !/(^|\.)(localhost|local|internal)$/i.test(u.hostname) && !value.includes("\\");
}
export function validatePayment(v) {
  const keys = ["recipient", "amount", "purchaseDescription", "justification", "category", "invoiceId", "evidence", "destinationChainId"];
  if (!record(v) || Object.keys(v).some(k => !keys.includes(k)) || !address.test(v.recipient ?? "") || amountAtomic(v.amount) === 0n) throw invalid("Supply a positive exact amount, recipient and supported payment fields.");
  for (const [k, min, max] of [["purchaseDescription", 3, 2000], ["justification", 3, 6000], ["category", 1, 200], ["invoiceId", 1, 200]])
    if (typeof v[k] !== "string" || v[k].length < min || v[k].length > max) throw invalid("Invalid " + k + ".");
  if (v.destinationChainId !== undefined && (!Number.isSafeInteger(v.destinationChainId) || v.destinationChainId < 1)) throw invalid("destinationChainId is a positive EVM chain ID, not a CCTP domain.");
  if (!Array.isArray(v.evidence) || v.evidence.length < 1 || v.evidence.length > 8 || v.evidence.some(e => !record(e) || Object.keys(e).some(k => !["url", "sha256"].includes(k)) || !evidenceUrl(e.url) || (e.sha256 !== undefined && !/^(0x)?[0-9a-fA-F]{64}$/.test(e.sha256)))) throw invalid("Supply one to eight public HTTPS evidence URLs and optional SHA-256 hashes.");
  if (new Set(v.evidence.map(e => e.url)).size !== v.evidence.length) throw invalid("Evidence URLs must be unique.");
  if (new TextEncoder().encode(canonicalJson(v)).length > 14000) throw invalid("Keep the complete payment within 14 KiB.");
}
export function normalizeSettlement(v, environment) {
  if (!record(v) || !PROFILES[environment]) throw invalid("Choose settlement in an explicit testnet or mainnet environment.");
  const versioned = "version" in v;
  if (Object.keys(v).some(k => !(versioned ? ["version", "paymentEnvironment", "asset", "destinationChainIds"] : ["asset", "destinationChainIds"]).includes(k)) ||
    (versioned && (v.version !== 2 || v.paymentEnvironment !== environment)) || (!versioned && environment !== "testnet")) throw invalid("Settlement version or payment environment does not match this deployment.");
  const ids = v.destinationChainIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > (versioned ? 11 : 3) || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || !PROFILES[environment].routes[id] || (!versioned && ![1952, 84532, 421614].includes(id)))) throw invalid("Choose unique destination chain IDs in this payment environment.");
  if (v.asset !== "USDC" && !(versioned && v.asset === "USDT0" && environment === "mainnet" && ids.length === 1 && ids[0] === 196)) throw invalid("USDT0 permits X Layer mainnet only; USDC uses the selected environment's destinations.");
  return {...(versioned ? {version: 2, paymentEnvironment: environment} : {}), asset: v.asset, destinationChainIds: [...ids].sort((a, b) => a - b)};
}
function redact(value, secrets) {
  if (typeof value === "string") return secrets.reduce((v, secret) => secret ? v.replaceAll(secret, "[REDACTED]") : v, value);
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k, secrets), redact(v, secrets)]));
  return value;
}
function retryAfter(value) {
  if (!value) return undefined;
  const n = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

class Transport {
  #fetch; #secrets;
  constructor(options, secrets = []) {
    this.profile = optionsFor(options); this.#fetch = options.fetchImpl ?? globalThis.fetch; this.#secrets = secrets;
    if (typeof this.#fetch !== "function") throw invalid("A Fetch implementation is required.");
  }
  setSecrets(secrets) { this.#secrets = secrets; }
  async call(path, {method = "GET", body, authorization, idempotencyKey, signal, owner = false, allowDegraded = false, extraSecrets = []} = {}) {
    const headers = {Accept: "application/json", "X-IntentGuard-Environment": this.profile.paymentEnvironment};
    if (authorization) headers.Authorization = authorization;
    if (owner) headers.Origin = this.profile.frontendOrigin;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
    const bounded = AbortSignal.timeout(this.profile.requestTimeoutMs), requestSignal = signal ? AbortSignal.any([signal, bounded]) : bounded;
    let response;
    try {
      response = await this.#fetch(this.profile.baseUrl + "/api/v1" + path, {method, headers,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: requestSignal,
        redirect: "error", credentials: owner && this.profile.frontendOrigin === this.profile.baseUrl ? "include" : "omit"});
    } catch {
      throw error(signal?.aborted ? "ABORTED" : "TRANSPORT_UNAVAILABLE", "The response was not obtained. Preserve the operation ID, exact payload and Idempotency-Key.", 0, !signal?.aborted);
    }
    if (response.status === 204 && response.ok) return undefined;
    let value;
    try { value = await response.json(); } catch {
      throw new IntentGuardError("IntentGuard returned a non-JSON response.", response.status, "INVALID_RESPONSE", true, response.headers.get("x-request-id") ?? undefined);
    }
    const safe = redact(value, [...this.#secrets, ...extraSecrets]);
    if (!response.ok && !(allowDegraded && response.status === 503 && safe?.status === "degraded")) {
      const e = record(safe?.error) ? safe.error : {};
      throw new IntentGuardError(typeof e.message === "string" ? e.message : "IntentGuard request failed.", response.status,
        typeof e.code === "string" ? e.code : "HTTP_ERROR", typeof e.retryable === "boolean" ? e.retryable : response.status === 429 || response.status >= 500,
        typeof e.requestId === "string" ? e.requestId : response.headers.get("x-request-id") ?? undefined,
        retryAfter(response.headers.get("retry-after")), e.details ?? (!record(safe?.error) ? safe : undefined));
    }
    if (!record(safe)) throw error("INVALID_RESPONSE", "IntentGuard returned an invalid JSON response.", response.status, true);
    return safe;
  }
  async capabilities(options) {
    const c = await this.call("/config", {signal: options?.signal}), p = this.profile;
    if (c.paymentEnvironment !== p.paymentEnvironment || c.mode !== p.paymentEnvironment || c.chainId !== p.sourceChainId)
      throw error("PAYMENT_ENVIRONMENT_MISMATCH", "The API payment environment or source chain differs from the explicit client profile.");
    if (c.apiOrigin !== p.baseUrl) throw error("API_IDENTITY_MISMATCH", "The configured API origin differs from this client endpoint.");
    if (c.frontendOrigin !== p.frontendOrigin || c.applicationUrl !== p.frontendOrigin || c.ownerSessionTransport !== (p.frontendOrigin === p.baseUrl ? "cookie" : "owner-bearer"))
      throw error("FRONTEND_IDENTITY_MISMATCH", "The configured frontend origin or owner session transport differs from this client profile.");
    if (c.reviewEnvironment !== "testnet" || c.reviewNetwork !== "studionet" || c.reviewChainId !== 61999 || c.reviewInfrastructure !== "studionet-simulator")
      throw error("REVIEW_IDENTITY_MISMATCH", "The API must identify GenLayer Studionet 61999 testnet review.");
    if ((p.expectedReleaseId !== undefined && c.releaseId !== p.expectedReleaseId) || (p.expectedSourceCommit !== undefined && c.sourceCommit !== p.expectedSourceCommit) ||
      (p.paymentEnvironment === "mainnet" && (typeof c.releaseId !== "string" || !c.releaseId.trim() || !/^[0-9a-f]{40}$/.test(c.sourceCommit ?? "") || c.settlementVersion !== 2)))
      throw error("RELEASE_IDENTITY_MISMATCH", "The API release or source identity is missing or differs from the pinned client profile.");
    if (typeof c.configured !== "boolean" || ![1, 2].includes(c.settlementVersion) || !Array.isArray(c.readinessReasons) || !Array.isArray(c.assets) || !Array.isArray(c.spendingNetworks))
      throw error("INVALID_RESPONSE", "The API configuration is missing readiness or capability fields.", 502);
    if (p.paymentEnvironment !== "local") {
      const pins = PROFILES[p.paymentEnvironment], ids = new Set(), assets = new Set();
      if (p.paymentEnvironment === "mainnet" && c.token?.toLowerCase() !== pins.usdt0) throw error("ASSET_CONFIGURATION_MISMATCH", "Mainnet legacy token must be the pinned USDT0 asset.");
      for (const a of c.assets) {
        if (!record(a)) throw error("INVALID_RESPONSE", "The API advertised an invalid asset capability.", 502);
        const token = a.asset === "USDC" ? pins.sourceUSDC : a.asset === "USDT0" ? pins.usdt0 : undefined;
        if (!record(a) || assets.has(a.asset) || token === undefined || a.chainId !== p.sourceChainId || a.decimals !== 6 || typeof a.available !== "boolean" ||
          (a.available && (!token || a.token?.toLowerCase() !== token)) || (a.asset === "USDT0" && p.paymentEnvironment === "testnet" && (a.available || a.token !== null)))
          throw error("ASSET_CONFIGURATION_MISMATCH", "An advertised asset conflicts with its payment environment and issuer identity.");
        assets.add(a.asset);
      }
      for (const n of c.spendingNetworks) {
        if (!record(n)) throw error("INVALID_RESPONSE", "The API advertised an invalid destination capability.", 502);
        const pin = pins.routes[n.chainId];
        if (!record(n) || !pin || ids.has(n.chainId) || n.domain !== pin.domain || n.token?.toLowerCase() !== pin.token) throw error("ASSET_CONFIGURATION_MISMATCH", "An advertised destination conflicts with its environment, token or CCTP domain.");
        ids.add(n.chainId);
      }
    }
    return c;
  }
  async ready(options) {
    const config = await this.capabilities(options);
    if (!config.configured) throw error("DEPLOYMENT_NOT_READY", "The deployment is not verified and configured; credentials were not submitted.", 503, true, {readinessReasons: config.readinessReasons});
    return config;
  }
  async health(options) {
    await this.capabilities(options);
    const h = await this.call("/health", {signal: options?.signal, allowDegraded: true});
    if (h.paymentEnvironment !== this.profile.paymentEnvironment || h.paymentChainId !== this.profile.sourceChainId || h.reviewEnvironment !== "testnet" || h.reviewNetwork !== "studionet" || h.reviewChainId !== 61999 || !["ready", "degraded"].includes(h.status)) throw error("INVALID_RESPONSE", "Health returned a mismatched deployment identity.", 502);
    return h;
  }
}

export class ProtocolClient extends Transport {
  #key; #cardId;
  constructor(options) { super(options, [options?.apiKey]); this.#key = options?.apiKey ?? ""; }
  async preflight(options) {
    assertKey(this.#key, this.profile.paymentEnvironment);
    const config = await this.ready(options), result = await this.call("/me", {signal: options?.signal, authorization: "Bearer " + this.#key}), card = result.card;
    if (!record(card) || !hash.test(card.id ?? "") || !nonzeroAddress(card.address) || card.chainId !== this.profile.sourceChainId || card.paymentEnvironment !== this.profile.paymentEnvironment ||
      card.reviewEnvironment !== "testnet" || card.reviewNetwork !== "studionet" || card.reviewChainId !== 61999 || !nonzeroAddress(card.token) ||
      (this.profile.expectedCardId !== undefined && card.id !== this.profile.expectedCardId) || (this.#cardId !== undefined && card.id !== this.#cardId))
      throw error("CARD_IDENTITY_MISMATCH", "The credential-bound card differs from the configured environment, chain or card identity.");
    if (!record(card.policy) || !hash.test(card.policyHash ?? "") || await commitment(card.policy) !== card.policyHash.toLowerCase()) throw error("CARD_IDENTITY_MISMATCH", "The returned policy does not match its canonical policy commitment.");
    if (card.settlement) {
      let settlement; try { settlement = normalizeSettlement(card.settlement, this.profile.paymentEnvironment); } catch { throw error("CARD_IDENTITY_MISMATCH", "The card settlement conflicts with this payment environment."); }
      if (settlement.version === 2 && card.reviewerVersion !== 4) throw error("REVIEW_IDENTITY_MISMATCH", "Version 2 settlement requires the environment-bound V4 reviewer.");
      const pin = PROFILES[this.profile.paymentEnvironment], token = settlement.asset === "USDC" ? pin.sourceUSDC : pin.usdt0;
      if (card.token.toLowerCase() !== token) throw error("ASSET_CONFIGURATION_MISMATCH", "The card token differs from its immutable settlement asset.");
    } else if (this.profile.paymentEnvironment === "mainnet" || card.token.toLowerCase() !== config.token?.toLowerCase()) throw error("CARD_IDENTITY_MISMATCH", "This card is missing its required settlement profile or legacy token binding.");
    this.#cardId = card.id;
    return {config, card, result};
  }
  async me(options) { return (await this.preflight(options)).result; }
  async request(payment, idempotencyKey, options) {
    validatePayment(payment);
    if (typeof idempotencyKey !== "string" || !/^[ -~]{1,128}$/.test(idempotencyKey)) throw error("IDEMPOTENCY_REQUIRED", "Provide a stable Idempotency-Key of 1–128 printable characters.", 422);
    const {card, config} = await this.preflight(options), destination = payment.destinationChainId ?? card.chainId;
    if (!(card.settlement?.destinationChainIds ?? [card.chainId]).includes(destination)) throw error("DESTINATION_NOT_ALLOWED", "The owner did not approve this destination.", 422);
    if (card.settlement && (config.assets.every(a => a.asset !== card.settlement.asset || !a.available) || config.spendingNetworks.every(n => n.chainId !== destination)))
      throw error("ASSET_OR_ROUTE_NOT_VERIFIED", "This asset and destination are not advertised as verified deployment capabilities.", 503, true);
    const result = await this.call("/requests", {signal: options?.signal, method: "POST", authorization: "Bearer " + this.#key, body: payment, idempotencyKey});
    if (!hash.test(result.id ?? "") || !REQUEST_STATES.includes(result.status)) throw error("INVALID_RESPONSE", "Admission returned an invalid operation ID or status. Reconcile using the same Idempotency-Key.", 502, true);
    return result;
  }
  async get(id, options) {
    if (!hash.test(id)) throw invalid("Use the saved 32-byte operation ID.");
    const {card} = await this.preflight(options), result = await this.call("/requests/" + encodeURIComponent(id), {signal: options?.signal, authorization: "Bearer " + this.#key});
    if (result.id !== id || result.cardId !== card.id || result.paymentEnvironment !== this.profile.paymentEnvironment || result.reviewEnvironment !== "testnet" || result.reviewNetwork !== "studionet" || result.reviewChainId !== 61999 || !REQUEST_STATES.includes(result.status)) throw error("REQUEST_IDENTITY_MISMATCH", "The operation response differs from this card or deployment.");
    if (result.bridge) {
      const b = result.bridge, pins = PROFILES[this.profile.paymentEnvironment], target = pins?.routes[b.destinationChainId];
      if (card.settlement?.asset !== "USDC" || !target || b.sourceChainId !== card.chainId || !card.settlement.destinationChainIds.includes(b.destinationChainId) || b.sourceToken?.toLowerCase() !== pins.sourceUSDC || b.destinationToken?.toLowerCase() !== target.token || b.destinationDomain !== target.domain) throw error("REQUEST_IDENTITY_MISMATCH", "The bridge receipt belongs to another environment, asset or destination.");
    }
    return result;
  }
  async poll(id, {timeoutMs = 30000, intervalMs = 5000, signal} = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(intervalMs) || intervalMs < 100) throw error("INVALID_WAIT_OPTIONS", "Use a nonnegative timeout and a polling interval of at least 100 ms.", 422);
    const end = Date.now() + timeoutMs, bounded = AbortSignal.timeout(Math.max(1, timeoutMs || this.profile.requestTimeoutMs)), combined = signal ? AbortSignal.any([signal, bounded]) : bounded;
    let last;
    do {
      try { last = await this.get(id, {signal: combined}); } catch (e) { if (last && bounded.aborted && !signal?.aborted) break; throw e; }
      if (TERMINAL_STATES.includes(last.status)) return {request: last, pending: false, operationId: id};
      const delay = Math.min(intervalMs, Math.max(0, end - Date.now()));
      if (!delay) break;
      await new Promise(resolve => { const done = () => { clearTimeout(timer); combined.removeEventListener("abort", done); resolve(); }, timer = setTimeout(done, delay); combined.addEventListener("abort", done, {once: true}); if (combined.aborted) done(); });
      if (signal?.aborted) throw error("ABORTED", "Polling stopped. Preserve and reconcile the same operation ID.", 0);
    } while (Date.now() < end);
    return {request: last, pending: true, operationId: id};
  }
  async wait(id, options = {}) {
    const result = await this.poll(id, {timeoutMs: 600000, ...options});
    if (result.pending) throw error("POLL_TIMEOUT", "The operation remains pending. Poll this same ID; timeout does not authorize another payment or burn.", 0, true, {operationId: id, lastStatus: result.request.status});
    return result.request;
  }
  listAgents(page = {}, options) { return this.call("/explorer/agents" + pageQuery(page), {signal: options?.signal}); }
  listTransactions(page = {}, options) { return this.call("/explorer/transactions" + pageQuery(page, true), {signal: options?.signal}); }
  getTransaction(id, options) { if (!hash.test(id)) throw invalid("Use a 32-byte transaction ID."); return this.call("/explorer/transactions/" + encodeURIComponent(id), {signal: options?.signal}); }
  getAgentCard(id, options) { if (!hash.test(id)) throw invalid("Use a 32-byte agent ID."); return this.call("/explorer/agents/" + encodeURIComponent(id) + "/card", {signal: options?.signal}); }
  async getBridgeProof(id, options) {
    if (!hash.test(id)) throw invalid("Use a 32-byte operation ID.");
    const result = await this.call("/explorer/transactions/" + encodeURIComponent(id) + "/proof", {signal: options?.signal}), proof = result.proof;
    const pins = PROFILES[this.profile.paymentEnvironment], target = pins?.routes[proof?.destinationChainId];
    if (result.id !== id || !record(proof) || proof.version !== 1 || proof.requestId !== id || proof.paymentEnvironment !== this.profile.paymentEnvironment ||
      proof.sourceChainId !== this.profile.sourceChainId || proof.reviewEnvironment !== "testnet" || proof.reviewNetwork !== "studionet" || !target ||
      typeof proof.sourceToken !== "string" || proof.sourceToken.toLowerCase() !== pins.sourceUSDC || typeof proof.destinationToken !== "string" || proof.destinationToken.toLowerCase() !== target.token || proof.destinationDomain !== target.domain ||
      !hash.test(result.proofHash ?? "") || await commitment(proof) !== result.proofHash.toLowerCase())
      throw error("PROOF_IDENTITY_MISMATCH", "The captured proof commitment, request, environment, token or destination differs from this client profile.");
    return result;
  }
}
function pageQuery(page, transactions = false) {
  if (!record(page) || Object.keys(page).some(k => !(transactions ? ["limit", "cursor", "agentId", "status"] : ["limit", "cursor"]).includes(k))) throw invalid("Unsupported pagination fields.");
  if (page.limit !== undefined && (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 50)) throw invalid("limit must be from 1 to 50.");
  if (page.cursor !== undefined && (typeof page.cursor !== "string" || page.cursor.length > 2048)) throw invalid("Use the returned explorer cursor.");
  if (page.agentId !== undefined && !hash.test(page.agentId)) throw invalid("Use a 32-byte agent ID.");
  if (page.status !== undefined && !REQUEST_STATES.includes(page.status)) throw invalid("Unknown request status.");
  const query = new URLSearchParams(Object.entries(page).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return query ? "?" + query : "";
}

/** Dashboard transport. Wallet signatures are supplied by the caller; no signing keys are accepted. */
export class OwnerClient extends Transport {
  #session = ""; #expiresAt = 0;
  constructor(options) { if (options?.apiKey !== undefined) throw invalid("Owner transport does not accept an agent API key."); super(options); }
  clearSession() { this.#session = ""; this.#expiresAt = 0; this.setSecrets([]); }
  assertFrontend() {
    if (globalThis.location?.origin && globalThis.location.origin !== this.profile.frontendOrigin) throw error("FRONTEND_IDENTITY_MISMATCH", "Owner actions must originate from the configured frontend.");
  }
  async sendOwner(path, config, options = {}, allowAnonymous = false) {
    this.assertFrontend();
    let authorization;
    if (config.ownerSessionTransport === "owner-bearer") {
      if (this.#session && this.#expiresAt <= Date.now()) { this.clearSession(); throw error("SESSION_EXPIRED", "Sign in again with the owner wallet.", 401); }
      if (!this.#session && !allowAnonymous) throw error("LOGIN_REQUIRED", "Sign in with the owner wallet; an agent key cannot authorize owner actions.", 401);
      if (this.#session) authorization = "Owner " + this.#session;
    }
    return this.call(path, {...options, owner: true, authorization});
  }
  async ownerCall(path, options, allowAnonymous = false) { return this.sendOwner(path, await this.ready(options), options, allowAnonymous); }
  async challenge(owner, options) {
    if (!nonzeroAddress(owner)) throw invalid("Supply the owner wallet address.");
    const c = await this.ready(options); this.assertFrontend();
    const result = await this.call("/auth/challenge", {...options, owner: true, method: "POST", body: {address: owner}});
    const lines = typeof result.message === "string" ? result.message.split("\n") : [];
    for (const line of ["IntentGuard owner login", owner.toLowerCase(), "URI: " + c.frontendOrigin, "API: " + c.apiOrigin, "Payment environment: " + c.paymentEnvironment, "Chain ID: " + c.chainId, "This signature authorizes a dashboard session only."])
      if (!lines.includes(line)) throw error("CHALLENGE_IDENTITY_MISMATCH", "Do not sign a challenge with different owner, origins or payment identity.");
    return result;
  }
  async login(owner, signature, options) {
    if (!nonzeroAddress(owner) || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw invalid("Supply the owner address and its challenge signature.");
    const c = await this.ready(options); this.assertFrontend();
    const result = await this.call("/auth/login", {...options, owner: true, method: "POST", body: {address: owner, signature}, extraSecrets: [signature]});
    if (result.address !== owner.toLowerCase()) throw error("INVALID_RESPONSE", "Owner login returned a different wallet identity.", 502);
    this.clearSession();
    if (c.ownerSessionTransport === "owner-bearer") {
      if (typeof result.ownerSession !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.ownerSession) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 600000) throw error("INVALID_RESPONSE", "Owner login returned an invalid or expired origin-bound session.", 502);
      this.#session = result.ownerSession; this.#expiresAt = result.expiresAt; this.setSecrets([this.#session]);
    } else if (result.ownerSession !== undefined) throw error("INVALID_RESPONSE", "Cookie login must not return a cross-origin session.", 502);
    return {address: result.address, expiresAt: this.#expiresAt || null, transport: c.ownerSessionTransport};
  }
  session(options) { return this.ownerCall("/auth/session", options, true); }
  async logout(options) { try { await this.ownerCall("/auth/logout", {...options, method: "POST"}, true); } finally { this.clearSession(); } }
  listCards(options) { return this.ownerCall("/owner/cards", options); }
  async createDraft(input, options) {
    if (!record(input) || Object.keys(input).some(k => !["description", "guidance", "settlement"].includes(k)) || typeof input.description !== "string" || input.description.length < 10 || input.description.length > 12000 || (input.guidance !== undefined && !record(input.guidance))) throw invalid("Supply a mission description of 10–12000 characters and optional guidance/settlement.");
    if (new TextEncoder().encode(canonicalJson({description: input.description, ...(input.guidance ? {guidance: input.guidance} : {})})).length > 16384) throw invalid("Keep the mission and guidance within 16 KiB.");
    const c = await this.ready(options), settlement = input.settlement === undefined ? undefined : normalizeSettlement(input.settlement, this.profile.paymentEnvironment);
    if (!settlement && this.profile.paymentEnvironment === "mainnet") throw error("SETTLEMENT_PROFILE_REQUIRED", "Choose explicit V2 mainnet settlement.", 422);
    if (settlement) assertSettlementCapability(c, settlement);
    return this.sendOwner("/owner/drafts", c, {...options, method: "POST", body: {...input, ...(settlement ? {settlement} : {})}});
  }
  async getDraft(id, options) {
    assertId(id); const result = await this.ownerCall("/owner/drafts/" + encodeURIComponent(id), options);
    if (result.id !== id) throw error("REQUEST_IDENTITY_MISMATCH", "The returned draft has a different ID.");
    if (result.settlement) {
      const s = normalizeSettlement(result.settlement, this.profile.paymentEnvironment);
      if (result.activation && result.activation.kind !== (s.asset === "USDT0" ? "USDT0_LOCAL" : s.version === 2 ? "CCTP_V4" : "CCTP_V2")) throw error("REVIEW_IDENTITY_MISMATCH", "Draft activation does not match its settlement/factory version.");
    }
    return result;
  }
  activateCard(input, options) {
    if (!record(input) || Object.keys(input).some(k => !["draftId", "cardAddress", "activationTx"].includes(k)) || !hash.test(input.draftId ?? "") || !nonzeroAddress(input.cardAddress) || !hash.test(input.activationTx ?? "")) throw invalid("Supply the draft ID, owner-confirmed vault address and confirmed activation transaction.");
    return this.ownerCall("/owner/cards", {...options, method: "POST", body: input});
  }
  getReplacement(id, options) { assertId(id); return this.ownerCall("/owner/cards/" + encodeURIComponent(id) + "/replacement", options); }
  async createReplacement(id, input, options) {
    assertId(id);
    if (!record(input) || Object.keys(input).some(k => !["settlement", "acknowledgeAccountingReset"].includes(k)) || input.acknowledgeAccountingReset !== true) throw invalid("Replacement requires an explicit accounting-reset acknowledgement.");
    const settlement = normalizeSettlement(input.settlement, this.profile.paymentEnvironment);
    if (settlement.version !== 2) throw error("EXPLICIT_SETTLEMENT_REQUIRED", "A replacement requires version 2 settlement.", 422);
    const c = await this.ready(options); assertSettlementCapability(c, settlement);
    return this.sendOwner("/owner/cards/" + encodeURIComponent(id) + "/replacement", c, {...options, method: "POST", body: {settlement, acknowledgeAccountingReset: true}});
  }
  retryReviewer(id, options) { assertId(id); return this.ownerCall("/owner/cards/" + encodeURIComponent(id) + "/reviewer", {...options, method: "POST"}); }
  async issueKey(id, options) { assertId(id); const result = await this.ownerCall("/owner/cards/" + encodeURIComponent(id) + "/keys", {...options, method: "POST"}); assertKey(result.apiKey, this.profile.paymentEnvironment); return result; }
  revokeKeys(id, options) { assertId(id); return this.ownerCall("/owner/cards/" + encodeURIComponent(id) + "/keys", {...options, method: "DELETE"}); }
  listRequests(options) { return this.ownerCall("/owner/requests", options); }
  getRequest(id, options) { assertId(id); return this.ownerCall("/owner/requests/" + encodeURIComponent(id), options); }
}
function assertId(id) { if (!hash.test(id)) throw invalid("Use the saved 32-byte identifier."); }
function assertSettlementCapability(config, settlement) {
  if (settlement.version === 2 && config.settlementVersion !== 2) throw error("ASSET_OR_ROUTE_NOT_VERIFIED", "The deployment does not expose a verified version 2 settlement factory.", 503, true);
  if (config.assets.every(a => a.asset !== settlement.asset || !a.available) || settlement.destinationChainIds.some(id => config.spendingNetworks.every(n => n.chainId !== id))) throw error("ASSET_OR_ROUTE_NOT_VERIFIED", "Every selected immutable asset and route needs verified deployment capability.", 503, true);
}
