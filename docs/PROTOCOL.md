# IntentGuard protocol integration manual

Protocol version **0.4.0**. Read this manual, [OpenAPI](openapi.json) and the [machine integration guide](../packages/sdk/integration.json) from the same checkout. The SDK and MCP package are unpublished source. Local preparation is not a deployed mainnet release.

## Purpose and payment semantics

An owner defines one immutable mandate and funds one X Layer vault. Its agent key admits invoice-backed purchases within that mandate. TapeOut checks numerical permission at reservation and settlement; a GenLayer reviewer checks evidence and mission fit. The vault releases funds only after successful finalized approval and a matching signed release.

HTTP **202** confirms durable admission. **PAID** confirms verified recipient delivery. APPROVED, a source burn, an attestation and a submitted destination mint remain pending. A public request record can describe a failed attempt; it is not necessarily a transfer.

The existing verified records are testnet: source X Layer 1952, native USDC and legacy synthetic TEST-USDT, with Studionet 61999 review. Testnet tokens have no monetary value. The separate mainnet payment preparation uses X Layer 196, USDC and local USDT0, and prominently disclosed **GenLayer Studionet testnet review**. Mainnet deployment, live canaries and independent hosted acceptance remain required.

## Choose an explicit deployment

Set `INTENTGUARD_BASE_URL` to the API origin and `INTENTGUARD_PAYMENT_ENV` to `testnet`, `mainnet` or `local`. There is no SDK/MCP default host or payment environment. Use HTTPS without credentials, paths, query or fragment; development HTTP is allowed only on loopback. Set `INTENTGUARD_FRONTEND_ORIGIN` when frontend and API differ.

The historical testnet application is https://intentguard-tapeout.vercel.app. Inspect its current `/api/v1/config` before authenticated use. Old hosted configurations missing the versioned identity are refused by current clients until the deployment is updated.

`GET /config` is anonymous and exposes:

| Field | Meaning |
|---|---|
| `mode`, `paymentEnvironment`, `chainId` | Explicit payment identity; testnet 1952 or mainnet 196 |
| `apiOrigin`, `frontendOrigin`, `applicationUrl` | Canonical API and approved frontend origins |
| `ownerSessionTransport` | Same-origin `cookie` or separate-origin `owner-bearer` |
| `reviewEnvironment`, `reviewNetwork`, `reviewChainId`, `reviewInfrastructure` | `testnet`, `studionet`, 61999, `studionet-simulator` |
| `releaseId`, `sourceCommit` | Release and full source identity, independently pinnable by clients |
| `configured`, `readinessReasons` | Actual readiness; false disables authenticated work |
| `settlementVersion`, `assets`, `spendingNetworks` | Verified deployment capabilities, distinct from candidate issuer pins |
| `factoryAddress`, `cctpFactoryAddress`, `guard` | Factory and processor configuration |
| `token`, `paymentSymbol` | Legacy compatibility asset; use the actual card token for funding |

`GET /health` exposes release identity, public readiness and worker freshness. HTTP 503 with `status: degraded` is a real health response, not payment readiness. Database connection failure uses the normal error envelope. No signing keys, session secrets or database credentials are public.

Mainnet clients require nonempty release identity, a full source commit and settlementVersion 2. Optional `expectedReleaseId`, `expectedSourceCommit` and `expectedCardId` pin the exact deployment/card. SDK/MCP verify anonymous config before transmitting the agent key, then verify `/me` policy commitment, source token, settlement and reviewer before admission. Every submission repeats this preflight. Credentials are never forwarded through redirects.

## Authorization scopes

| Scope | Transport and authority |
|---|---|
| Public | No Authorization header or cookies for configuration, health, explorer, cards or proofs |
| Agent | `Authorization: Bearer ig_…` on testnet/local; `Bearer ig_mainnet_…` on mainnet; one immutable card |
| Owner, same origin | HttpOnly `ig_session` cookie; one-hour maximum age |
| Owner, separate origin | `Authorization: Owner <session>`; held in memory, expires within ten minutes, bound to API/frontend/payment identity |
| Merchant administrator | Separate Bearer credential for the testnet invoice endpoint; agent keys cannot issue invoices |
| Sandbox visitor | `Authorization: Sandbox <visitor capability>`; one-hour, origin-bound access to fixed dedicated testnet scenarios; no cookies |

Owner browser requests declare `X-IntentGuard-Environment` and use the exact approved frontend `Origin`. Wallet login challenges bind owner address, API origin, frontend origin, payment environment and chain, expire within five minutes and are consumed once. The signature authorizes dashboard access only. Separate-origin tokens stay out of localStorage, shared links, downloaded cards and agent configuration; a reload requires login again.

Agent keys cannot sign arbitrary wallet transactions, change immutable policy, choose another card, withdraw, deploy or issue invoices. API, database, session, agent, operator and attestor authority remain isolated by payment environment. The SDK owner client accepts a challenge signature supplied by the caller; it accepts no agent key or signing key.

## Visitor sandbox

The `/sandbox` application uses a **dedicated native-USDC card on X Layer testnet1952**, with local settlement only and Studionet61999 testnet review. Its agent API key stays on the server. Visitors choose a fixed scenario, start a temporary session and inspect the actual operation without a wallet or an agent key. Read the current `/config` and `/sandbox` response to establish deployment identity and availability; source implementation alone is not live acceptance evidence.

| Endpoint | Input and result |
|---|---|
| `GET /sandbox` | Anonymous `{enabled,scenarios,...}`; enabled response includes dedicated policy, balances, network disclosures and limits; disabled response includes `reasonCode,message` |
| `POST /sandbox/session` | Empty JSON `{}` with approved frontend `Origin` →201 `{visitorToken,expiresAt,requestsRemaining}`; expiry is epoch **milliseconds** |
| `POST /sandbox/requests` | `Authorization: Sandbox <token>`, approved `Origin`, stable 1–64-character alphanumeric/underscore/hyphen `Idempotency-Key`, JSON `{scenario}` →202 `{id,status,scenario,publicUrl,...}` |
| `GET /sandbox/requests/{id}` | Same visitor capability and origin → actual `RequestView` plus scenario and public URL; other visitor bindings return404 |

Scenarios are `permitted` (expected PAID), `blocked` (expected BLOCKED), `prohibited` (expected REJECTED), and `wrong-buyer` (expected NEEDS_EVIDENCE). Expected labels explain the test; they never replace actual guard, review, failure or payment status. Permitted requests can be delayed, cancelled or rejected. PAID still requires verified delivery.

For `blocked`, normal durable admission is followed by a claimed numerical preview against the live vault. An actual denial can record BLOCKED with review SKIPPED immediately, without a model call or payment signature. A preview that allows the request or is unavailable does not invent a block; the same admitted record continues through the worker. Semantic scenarios retain asynchronous finalized review.

Normal requests use **0.000001 native testnet USDC**. The blocked scenario requests **0.010001** against the immutable **0.01** per-payment limit. Recipient, asset, chain, purpose and invoice are constructed by the gateway; arbitrary payment fields are refused. Each visitor has five preparations per one-hour session and five submit attempts per minute. The card permits six new preparations per minute and a durable lifetime ceiling of30 by default, configurable1–100. Repeating the same scenario/key returns the same operation; changed scenario returns409 IDEMPOTENCY_CONFLICT. Concurrent admission can return503 SANDBOX_REQUEST_PENDING with Retry-After5; retry the same scenario/key. Key rotation does not replenish the per-card ceiling.

Keep the capability in private memory, never localStorage, URLs, prompts or logs. Requests use `credentials: "omit"` even on the same origin. Owner sessions, `ig_` agent keys and wallet signatures never enter the visitor transport. Expiry or session/identity failure discards the SDK capability. Card pause/revocation or a balance RPC outage does not prevent tracking an existing request with a still-valid capability. After expiry or reload, inspect its saved public URL; starting a new session does not recover another session's private binding or authorize repeating an uncertain purchase.

```ts
import {IntentGuardSandbox} from "./packages/sdk/index";
const sandbox = new IntentGuardSandbox({
  baseUrl: "https://<VERIFIED_TESTNET_API_ORIGIN>",
  paymentEnvironment: "testnet",
  // frontendOrigin when the approved frontend has a different origin.
});
const availability = await sandbox.capabilities();
if (!availability.enabled) throw new Error(availability.message);
await sandbox.startSession(); // Returns expiry/allowance; keeps visitorToken private.
const admitted = await sandbox.request("wrong-buyer", savedVisitorOperationKey);
// Preserve admitted.id/publicUrl and the same key; poll get about every five seconds.
const actual = await sandbox.get(admitted.id);
// Display actual.status and reviewStage; never replace them with the expected label.
sandbox.clearSession();
```

Operators configure `INTENTGUARD_SANDBOX_CARD_ID`, `INTENTGUARD_SANDBOX_OWNER`, `INTENTGUARD_SANDBOX_API_KEY`, optional `INTENTGUARD_SANDBOX_MAX_REQUESTS`, and the existing private `SESSION_SECRET`. Never use NEXT_PUBLIC for credentials. The bootstrap `plan` writes a policy/draft input without signing; `bind` independently verifies the dedicated card and stores its one-time key in a private file. The owner separately approves creation/funding. See [sandbox operations](production/SANDBOX.md) for commands and verification gates. No visitor MCP execution tools are installed; the bundled resources document the direct API/SDK flow. The existing MCP remains a separately scoped agent transport.

## Immutable policy and evidence

Policy version remains 1. Existing canonical policy/request/evidence commitments and reviewer source versions remain unchanged. Review every proposed term before the owner wallet activates it.

| Field | Constraints |
|---|---|
| `name`, `mission`, `taskContext` | Name 1–80; mission 3–4,000; context up to 6,000 characters |
| `allowedCategories` | 1–20 categories, each 1–200 characters |
| `prohibitedPurchases`, `exceptions` | Up to 20 entries each, up to 500 characters; exceptions never override numerical limits |
| `financial.totalBudget` | Positive lifetime cumulative permission |
| `financial.perPaymentLimit` | Positive per-request cap, no greater than lifetime budget |
| `financial.periodBudget`, `periodSeconds` | Positive period budget; integer period 60–31,536,000 seconds |
| `financial.validFrom`, `validUntil` | Unix seconds; expiry after start |
| `merchants` | 1–32 unique recipients; name up to 100 characters, 1–10 public HTTPS origins, up to 30 products of 200 characters |
| `evidence.requiredTypes`, `approvedOrigins`, `maxAgeSeconds` | 1–10 types, 1–30 public HTTPS origins, age 1–31,536,000 seconds |
| `criteria` | 1–12 unique IDs matching letters/numbers/underscore/hyphen, up to 40 characters; descriptions 3–1,000 characters |

All amounts are exact decimal strings with at most six fractional digits. The maximum is `18446744073709.551615`, equal to uint64 atomic units `18446744073709551615`. Never round, use exponent syntax or send JSON floating-point money. One USDC/USDT0/legacy TEST-USDT is 1,000,000 atomic units.

### Templates and clear setup input

Create agent offers **Research assistant** (`research`), **API access** (`api-access`) and **Protocol test** (`protocol-test`, testnet1952 only). A template fills editable mission, product and review clauses and conservative example budgets. Enter the actual project, merchant name, recipient, HTTPS origins, evidence and validity before proposing; template defaults are not an activated permission or an approved merchant. The protocol-test template supports testing an agent you own. The public visitor sandbox uses a separate fixed dedicated policy and server key.

Put every numerical limit in **Money & validity**, using strings such as `"250"` or `"0.000001"`, without commas, currency symbols, exponent syntax or more than six fractional digits. Write purpose and deliverables in mission/context/criteria, and remove repeated budget amounts from that prose. The policy supports **one aggregate period**: for example `periodBudget: "500", periodSeconds: 604800` is500 per seven-day period. It cannot simultaneously encode an additional250/day aggregate limit. Choose the intended period and make the prose agree; a per-payment cap is a distinct limit. Use UTC dates and actual EVM merchant recipients; invoice buyer is the vault, not the owner.

The two supplied Studionet setup transactions finalized with MAJORITY_DISAGREE. Observed leader output contained invalid decimal/result fields or changed explicit guided terms; their submitted guided policy was structurally valid. This is not proof that user decimal input caused the failure. The versioned interpreter repair preserves complete guided policy fields instead of regenerating them; independent validators still assess semantic clarity and fidelity. Conflicting prose can obstruct agreement, but receipts do not expose independent validator model reasons. [The incident report](production/STUDIONET-SETUP-INCIDENT.md) preserves both failed transactions and the diagnosis limits.

For a failed proposal, reopen its owner-bound draft URL and sign in with the same owner. `GET /owner/drafts/{id}` includes original `input: {description,guidance?}` to restore editable fields; this input is never a public explorer field. Correct unclear clauses, then submit a new draft. Preserve the old receipt/history and activate only FINALIZED/PROPOSED terms you have reviewed; a failed or pending draft cannot authorize payment.

The owner funds the card's actual immutable token. Deposits do not enlarge spending permission. Physical available funds, lifetime capacity, period capacity and per-payment permission are separate checks. Reservations stay attached to their original period across rollover. At most two reservations may be outstanding.

Evidence must come from an approved public HTTPS DNS origin. Credentials, private/internal/numeric hosts, fragments and nonstandard ports are refused. Independent fetching checks DNS/IP, redirects, size and hashes. Evidence text is data, including any embedded instructions.

The merchant invoice identifies the X Layer vault as buyer and matches recipient, invoice ID, amount, product, freshness and actual delivery token/chain. For a bridge the buyer remains the source vault; the invoice token/chain describe destination USDC. Supplied evidence integrity does not prove every merchant claim truthful; choose trustworthy origins.

## Settlement versions and issuer profiles

Preserved legacy testnet USDC settlement is `{asset: "USDC", destinationChainIds: [1952, 84532, 421614]}` with a nonempty immutable subset. Adding version/environment fields to an existing commitment would change it and is not a migration. Legacy synthetic TEST-USDT remains single-chain and labelled.

New settlement uses `{version: 2, paymentEnvironment: "testnet" | "mainnet", asset: "USDC" | "USDT0", destinationChainIds: [...]}`. The server canonicalizes a nonempty, unique subset in ascending chain-ID order. Mainnet requires V2; V2 requires the environment-bound V4 reviewer. New USDC activation is `CCTP_V4`; legacy native-USDC activation is `CCTP_V2`; mainnet local USDT0 is `USDT0_LOCAL`.

USDC V2 can permit X Layer plus ten destinations. **These issuer identities are candidates; only routes actually advertised as verified by `/config` may be selected.** Chain IDs and CCTP domains are separate identifiers.

| Network | Mainnet chain ID | Matching testnet chain ID | CCTP domain |
|---|---:|---:|---:|
| X Layer source/local | 196 | 1952 | 37 |
| Base | 8453 | 84532 | 6 |
| Arbitrum | 42161 | 421614 | 3 |
| Optimism | 10 | 11155420 | 2 |
| Ethereum | 1 | 11155111 | 0 |
| Polygon | 137 | 80002 | 7 |
| Avalanche | 43114 | 43113 | 1 |
| Unichain | 130 | 1301 | 10 |
| Linea | 59144 | 59141 | 11 |
| World Chain | 480 | 4801 | 14 |
| HyperEVM | 999 | 998 | 19 |

Source native USDC: testnet `0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3`, mainnet `0xb6ceceab302e2e4948951ee7843fc24e92933061`. Mainnet USDT0 is `0x779ded0c9e1022225f8e0630b35a9b54be713736`, permits only destination 196, and is disabled on testnet. Exact destination token pins ship in `packages/sdk/client.mjs`, OpenAPI and the shared candidate issuer registry. The historical live testnet release verifies only X Layer/Base/Arbitrum; expanding the registry does not certify additional live delivery.

## Agent payment API

Paths are relative to `/api/v1`.

| Endpoint | Result |
|---|---|
| `GET /me` | `{card: CardView}`; immutable policy, token, settlement, reviewer and actual balances |
| `POST /requests` | HTTP 202 `{id,status}`; requires stable `Idempotency-Key` |
| `GET /requests/{id}` | Same card-scoped operation, commitments, review stage, error and receipt/bridge progress |

Payment fields: `recipient`, positive exact `amount`, `purchaseDescription` (3–2,000), `justification` (3–6,000), `category` (1–200), `invoiceId` (1–200), one to eight `evidence` entries `{url,sha256?}`, and optional positive integer `destinationChainId`. Default destination is the card's source chain. The complete canonical payment is limited to 14,000 bytes; evidence URLs must be unique. Unknown fields cannot change owner, card or asset.

The idempotency key is 1–128 printable ASCII characters. Admission ID is SHA-256 of canonical `{cardId,idempotency}`. Same card/key/input returns the original operation, including after credential rotation. Changed input returns 409 IDEMPOTENCY_CONFLICT. The vault separately prevents duplicate pending/paid merchant+invoice commitments across different operation keys.

Persist the returned ID, exact payment and operation key. Poll the same ID about every five seconds with a bounded deadline. If the POST response is lost, resend identical input with the same key. A timeout never creates another purchase or cancels a source burn.

Pending states: QUEUED, RESERVED, REVIEWING, AWAITING_FINALITY, APPROVED, RETRYING, BRIDGING, AWAITING_ATTESTATION, MINTING. Terminal states: PAID, BLOCKED, REJECTED, NEEDS_EVIDENCE, EXPIRED, CANCELLED. `reviewStage` separately reports PENDING, COMPLETE, SKIPPED or FAILED. Only `reasoningSource: genlayer-finalized-contract` presents independently verified finalized reasoning; unavailable, failed and skipped review are explicit.

## CCTP receipts and recovery

Guard reservation and successful finalized evidence approval precede source burn through Circle TokenMessengerV2. Standard transfer uses finality threshold 2000, maxFee 0, destinationCaller zero and empty hook data. Required fee changes disable new burns until explicit fee-aware support exists; the merchant amount is never silently reduced.

The worker verifies source MessageSent/BridgeStarted events, captures raw message bytes, obtains Iris V2 public attestation and validates immutable source/destination/token/vault/merchant/amount/finality/fee fields. Iris fills nonce and executed-finality fields, so whole source-versus-attested byte equality is inappropriate.

Destination MessageTransmitterV2 verifies Circle's attestation. The worker independently checks consumed nonce/message, native-USDC mint and exact merchant amount; a successful transaction hash alone is insufficient. PAID requires the destination mint plus source-vault acknowledgement. CCTP `paymentTxHash` is the destination transaction; `bridge.sourceTxHash` and `confirmationTxHash` remain separate source transactions.

`bridge` contains protocol CCTP_V2, phase BURNED/ATTESTATION_PENDING/ATTESTED/MINT_SUBMITTED/CONFIRMED, source/destination chain and token, destination domain, exact amount, source transaction and timestamp, with message hash, nonce, destination transaction and acknowledgement as observed.

An irreversible burn consumes lifetime and original-period permission before delivery. `balances.spent` includes it; public/downloaded `fundsMoved` excludes it until PAID. Key revocation, pause, cancellation, expiry, RPC/Iris failure, gas shortage and Actions interruptions cannot cancel or repeat it. Signed source/destination bytes are persisted before broadcast; reconciliation resumes the same record.

`GET /explorer/transactions/{id}/proof` returns `{id,proof,proofHash,verification}`. `proofHash` is SHA-256 of canonical JSON and covers the captured source/message/attestation/destination/acknowledgement evidence. Independently compare public receipts, commitments and amount/recipient/domain/nonce/balance evidence. Older records without captured proof return 404 PROOF_UNAVAILABLE and retain historical release evidence; no fabricated proof is substituted.

X Layer trusts the configured receipt attestor for foreign-chain acknowledgement. Circle's attestation verification and IntentGuard's receipt-attestor/RPC trust are separate; this is not a foreign-chain light-client proof.

## Owner API and replacement

| Endpoint | Payload/result |
|---|---|
| `POST /auth/challenge`, `/auth/login` | Origin/environment/owner-bound message; caller signs it, then supplies `{address,signature}` |
| `GET /auth/session`, `POST /auth/logout` | Current address/null; revoke session or expire cookie |
| `POST /owner/drafts` | `{description,guidance?,settlement?}` → 202 `{id,status}`; mission/guidance at most 16 KiB |
| `GET /owner/drafts/{id}` | Original owner-only input, proposal state, policy/questions/interpretation and verified activation arguments when finalized |
| `GET /owner/cards`, `POST /owner/cards` | List real owned cards; register exact owner-confirmed `{draftId,cardAddress,activationTx}` receipt |
| `POST /owner/cards/{id}/reviewer` | Retry only failed initialization, preserving vault/policy/history |
| `POST /owner/cards/{id}/keys` | Issue/rotate once after active card and reviewer readiness; old keys stop authorizing |
| `DELETE /owner/cards/{id}/keys` | Revoke credential; cancel before payment/burn, continue existing burns |
| `GET /owner/cards/{id}/replacement` | Complete pending count, bounded IDs, balances and owner procedure |
| `POST /owner/cards/{id}/replacement` | Explicit V2 settlement plus `acknowledgeAccountingReset: true`; creates a policy-copy draft |
| `GET /owner/requests`, `/owner/requests/{id}` | Owned operations and resumable state |

Replacement creates a **new empty vault** with the same policy and new per-vault lifetime/period accounting. Old balances, reservations, keys and history do not move. Reconcile pending requests; revoke old credentials, withdraw unreserved funds and deposit into the new vault through explicit owner wallet transactions. Existing burns continue their original route. Owner funding, pause/resume, revocation, cancellation and withdrawal are wallet contract calls, separate from HTTP requests. Revoked vaults cannot resume.

## Public explorer, cards and invoices

`GET /explorer/agents` and `/explorer/transactions` return arrays plus opaque `nextCursor`. `limit` is integer 1–50, default 20. Transactions accept `agentId` and `status`. Ordering is createdAt descending then ID descending; preserve filters and pass returned cursor unchanged.

`GET /explorer/transactions/{id}` returns `{transaction,agent,reviewStage,reasoningSource}`. Public fields omit justification, snapshot contents, secrets and signed bytes. Published policy/mission, addresses, amounts and cited reasoning remain public; keep private information out of mandates.

`GET /explorer/agents/{id}/card` returns `{agent,usage,shareUrl}`. Usage counts actual admitted operations, not HTTP retries, and includes requestCount/paidCount/blockedCount/rejectedCount/needsEvidenceCount/cancelledCount/activeCount, PAID-only fundsMoved, source token/chain and asOf. Contract balances remain separate. `card.svg` is a standalone attachment; UI also offers PNG and an X composer. Attach the image manually. A card is a public as-of identity snapshot, not a key, NFT, bank card or proof of solvency.

`POST /demo/invoices` is testnet-only and requires a separate merchant administrator credential. It creates an actual immutable invoice from `{buyer,amount,description,chainId?,token?}`; chainId/token must appear together, or both be omitted only for the legacy configured token. Currently accepted invoice assets are the configured legacy token or native USDC on the original three supported testnets. `GET /demo/invoices/{id}` is public. Historic expired invoices are evidence and cannot authorize new purchases. The merchant endpoint never seeds fake activity or settles a payment.

## Errors, quotas and worker behavior

Error envelope: `{error:{code,message,retryable,requestId,details?}}`. X-Request-Id correlates calls. Retry-After is seconds until an appropriate retry; preserve the same operation key. HTTP and financial status are separate.

| HTTP | Meaning and representative codes |
|---|---|
| 400 | Malformed JSON: INVALID_JSON |
| 401 | Missing/revoked/expired authority: KEY_REQUIRED, KEY_REVOKED, LOGIN_REQUIRED, INVALID_SIGNATURE |
| 403 | Authorization/origin: ORIGIN_DENIED |
| 404 | Missing record: NOT_FOUND, PROOF_UNAVAILABLE |
| 409 | State/idempotency/identity: IDEMPOTENCY_CONFLICT, REVIEWER_PENDING, PAYMENT_ENVIRONMENT_MISMATCH |
| 422 | Fields/permission: INVALID_INPUT, DESTINATION_NOT_ALLOWED, INVOICE_ASSET_REQUIRED |
| 429 | Fixed-minute RATE_LIMIT |
| 503 | Unavailable dependencies or unverified deployment |
| 405 / 413 / 415 | Wrong method with Allow / body over 32 KiB / unsupported media type |

Use the returned code and retryable flag; not every 409 is retryable. Authenticated quota headers are RateLimit-Limit, Remaining, Reset (seconds to next fixed minute), Policy. Agent quota is 60 calls per fixed UTC minute; owner 120; login challenge 10 per address. One polling loop respects these quotas.

GitHub Actions is the live executor. Durable MongoDB records, workflow/ref verification, trigger leases/cooldown, heartbeat/deadline and schedules preserve recovery. API keys/signing secrets are isolated; the API does not start a local live worker. Signed transactions are saved before broadcasting. Worker queues rotate fairly and reconcile after restarts. Continuous unburned processing waits beyond thirty minutes fail/cancel only after reservation release is confirmed; existing burns remain active for delivery. Actions startup, RPC and GenLayer finality cause real latency.

## SDK and MCP setup

Use locked Node 24 and pnpm 11.9.0. Vendor the complete `packages/sdk` directory or import its TypeScript entrypoint from a checkout; it has no server/database/wallet dependency. The browser-safe runtime is `packages/sdk/client.mjs`.

```ts
import {IntentGuard, IntentGuardError} from "./packages/sdk/index";
const ig = new IntentGuard({
  baseUrl: process.env.INTENTGUARD_BASE_URL!,
  paymentEnvironment: "testnet", // explicit verified deployment
  apiKey: process.env.INTENTGUARD_API_KEY,
});
const config = await ig.capabilities(); // anonymous
const {card} = await ig.me(); // verify deployment before credentials, then actual card
// actualPayment must match a current authorized merchant invoice.
const {id} = await ig.request(actualPayment, savedOperationKey);
// Persist id + exact input + operation key before waiting.
try { const final = await ig.wait(id, {timeoutMs: 45000}); }
catch (error) {
  if (error instanceof IntentGuardError && error.code === "POLL_TIMEOUT") {
    // Resume ig.get(id); never create another purchase because polling timed out.
  } else throw error;
}
```

`IntentGuard` offers capabilities, health, me, request, get, wait and public list/detail/card/proof methods. `IntentGuardOwner` offers challenge/login/session/logout, cards/drafts/confirmed registration, reviewer retry, explicit replacement and key issuance/revocation. Owner login returns metadata, keeping the separate-origin token in private memory. `IntentGuardError` retains status, code, retryable, requestId, retryAfterSeconds and redacted details. SDK wait defaults to ten minutes; explicit deadlines and AbortSignal are supported. Timeout preserves the original ID.

`IntentGuardSandbox` offers capabilities, startSession, request, get and clearSession. Its runtime export is `SandboxClient`; options require `paymentEnvironment: "testnet"` and reject agent credentials, external tokens and owner/signing authority. It verifies explicit API/frontend/source/review identity before sending a visitor capability. It never returns that capability from startSession, and never uses cookies. Save public operation metadata for recovery; the visitor session itself stays in memory.

For MCP, install `npm ci --ignore-scripts --prefix packages/mcp`, then run `node packages/mcp/src/cli.mjs` with `INTENTGUARD_BASE_URL` and `INTENTGUARD_PAYMENT_ENV`. Inject `INTENTGUARD_API_KEY` from the owner's secret manager for authenticated tools. Optional pins: INTENTGUARD_FRONTEND_ORIGIN, INTENTGUARD_SOURCE_CHAIN_ID (local), INTENTGUARD_EXPECTED_RELEASE_ID, INTENTGUARD_EXPECTED_SOURCE_COMMIT, INTENTGUARD_EXPECTED_CARD_ID. The private package is not published as `npx @intentguard/mcp`.

Read `intentguard://protocol`, `intentguard://openapi`, `intentguard://integration`. Tools: get_config, get_health, get_my_agent, submit_payment, get_payment, wait_for_payment, list_agents, list_transactions, get_transaction, get_agent_card, get_bridge_proof. Prompt: payment_integration(task). Public tools never send a credential. submit_payment is the only payment-admission mutation. wait_for_payment is bounded to 45 seconds, returning the same pending operation ID. MCP has no owner signing, wallet withdrawal or merchant-admin authority. Success returns `{ok:true,status,data}`; failures return `isError` and `{ok:false,error}`.

Install the [repository skill](../skills/intentguard/SKILL.md) with `npx skills add TS-mfon/intentguard --skill intentguard`. Its protocol/OpenAPI/integration references are bundled locally. Never copy an API key into prompts or shared configuration.

## TapeOut, GenLayer and evidence limits

The circuit has 451 inputs, 1,766 NAND gates, eight outputs and zero state; source artifacts reproduce these figures. The vault calls it before reservation and settlement. The historical processor is `TESTNET_ADAPTER_UNMODIFIED_TAPEOUT_NETLIST_VM`, executing unchanged TapeOut NetlistVM on X Layer testnet. Official TapeOut CPU-registry deployment and DeWEB hosting are separate live requirements.

V4 review binds explicit payment environment and testnet review profile, source token, policy, request, evidence and destination. V3 native-USDC and V1/V2 legacy reviewers remain source-pinned. V2 deterministic preflight can finalize objective permission/evidence failures without a model override; semantic approval still needs model validation. GenLayer validator/model participation varies; consensus cannot guarantee impossible hallucinations or universal prompt-injection resistance.

X Layer trusts configured attestation of foreign-chain review and receipt finality. Budget/recipient constraints remain numerical protection if semantic approval is wrong. Gateway/attestor compromise, upgrade/provenance pins, Actions source, durable database, RPC/issuer availability and merchant honesty are explicit dependencies.

The [historical native-USDC audit](audits/cctp-independent.json) verified eight planned scenarios on the original testnet profile. The [original twelve-request audit](AUDIT-12-FINDINGS.md) remains failed at ten matched outcomes, including unresolved legacy semantic consensus cases. Neither certifies the new mainnet release, expanded destinations or two fresh reliability rounds. [Commercial preparation](COMMERCIAL.md) and [demo materials](DEMO.md) preserve missing customer, hosted and film evidence. The complete [R01–R27 contract](production/REMEDIATION-PLAN.md) remains authoritative.
