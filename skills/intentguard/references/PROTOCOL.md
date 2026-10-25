# IntentGuard protocol integration manual

Version 0.2. Testnet deployment. Canonical application: https://intentguard-tapeout.vercel.app. API base: https://intentguard-tapeout.vercel.app/api/v1.

This document is bundled with the MCP server and agent skill. An integration can be built from this file and the bundled OpenAPI without visiting the website.

## Purpose and delivery semantics

An owner issues an immutable spending mandate to one agent vault. The agent requests payments with its own bearer credential. TapeOut enforces numerical and permission boundaries on X Layer; GenLayer reviews merchant evidence and mission fit. The worker settles only a successful finalized approval. HTTP 202 acknowledges a durable operation. **Only payment status PAID confirms the requested token transfer.** APPROVED is awaiting settlement.

TEST-USDT has no monetary value. The hosted payment chain is X Layer Testnet (1952); semantic review uses GenLayer Studionet (61999). Query GET /config before integrating. Never substitute X Layer mainnet (196), mainnet USDT, or a wallet's current chain without matching the configured deployment.

## Quick integration

1. A human connects their EVM wallet at /agent-setup, signs the single-use authentication challenge and proposes a complete mandate.
2. The human reviews the successfully finalized typed policy, activates the exact factory configuration on X Layer Testnet and registers the confirmed vault.
3. Fund the vault with the configured TEST-USDT. Wait for setupState READY, reviewer source/policy verification and onchain ACTIVE status. Funding alone does not imply readiness.
4. The human issues an agent API key. It is revealed once. Put it in INTENTGUARD_API_KEY in a secret manager or process environment. The API stores a hash.
5. GET /me using Authorization: Bearer <key>. Read the actual policy, chain, token, card address, balances, merchant recipients, approved origins and criteria.
6. Obtain a real merchant invoice naming the **vault address as buyer**. Owner-wallet buyer, stale invoices, unsupported origins, wrong token, wrong chain and mismatched amounts cannot be paid.
7. POST /requests with JSON and a stable Idempotency-Key for this business operation. Persist the request ID and exact input before retrying.
8. GET /requests/{id} every five seconds. Inspect both HTTP errors and the returned payment status. Stop at a terminal status. Save paymentTxHash and the final decision.
9. For missing evidence or rejected purchases, diagnose the actual error/criteria. Corrected business operations use a new input, operation key and, where needed, a new merchant invoice.

Example curl (replace angle-bracket values with owner-approved data):

```sh
curl --fail-with-body 'https://intentguard-tapeout.vercel.app/api/v1/me' \
  -H "Authorization: Bearer $INTENTGUARD_API_KEY"

curl --fail-with-body 'https://intentguard-tapeout.vercel.app/api/v1/requests' \
  -H "Authorization: Bearer $INTENTGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <stable-operation-key>' \
  --data '{
    "recipient":"<approved-merchant-EVM-address>",
    "amount":"1.000001",
    "purchaseDescription":"<actual-purchase>",
    "justification":"<how-this-serves-the-approved-mission>",
    "category":"<permitted-category>",
    "invoiceId":"<merchant-invoice-id>",
    "evidence":[{"url":"https://<approved-host>/invoice.json"}]
  }'
# Admission response: {"id":"0x<64 hex characters>","status":"QUEUED"} HTTP 202.

curl --fail-with-body 'https://intentguard-tapeout.vercel.app/api/v1/requests/<request-id>' \
  -H "Authorization: Bearer $INTENTGUARD_API_KEY"
```

A retry already PAID may still return HTTP 202 with its original id and current status. Interpret the body; do not infer finality from the POST status alone.

## Authentication and authority

| Caller | Credential | Authority |
|---|---|---|
| Public explorer | None | Read published identities, payment summaries and verified reasoning |
| Agent | Authorization: Bearer agent-key | Read its own /me, submit payments, read its own requests |
| Human owner | HttpOnly ig_session from verified wallet signature | Propose/register cards, issue/rotate/revoke keys, read owned records, retry failed reviewer |
| Merchant operator | Separate merchant-administrator bearer | Issue configured reference-merchant testnet invoices |
| Worker | Three dedicated signing keys in GitHub secrets | Journal and execute gateway, GenLayer and attestor operations |

Agent keys never permit withdrawals, arbitrary contract signing, changing policy, selecting another vault, owner authentication or merchant invoice issuance. A request outside the credential's card returns 404 to avoid disclosing private records. Owner mutations require an allowed same-application Origin and cookie. Do not send a key in a query string, URL, tool argument, log, shared ATM card or X post.

Owner challenge: POST /auth/challenge with {"address":"<owner>"} returns {"message":"<exact challenge>"}. Sign that exact message, then POST /auth/login with {"address":"<owner>","signature":"0x..."}; success returns the session cookie. GET /auth/session returns {"address":string|null}; POST /auth/logout clears it. A changed account must authenticate again. Login does not transfer funds.

## Complete policy schema

The proposal input is {"description":string,"guidance":object?}; description 10–12,000 characters, complete canonical input at most 16 KiB. Guidance can express the complete policy below; the intelligent contract proposes typed terms which the human must review.

| Policy field | Type and constraints |
|---|---|
| version | Exactly 1 |
| name | String 1–80, human-controlled identity |
| mission | String 3–4,000, purpose for permitted purchases |
| taskContext | String up to 6,000, may be empty |
| allowedCategories | Array 1–20 strings of 1–200 |
| prohibitedPurchases | Array up to 20 strings up to 500 |
| exceptions | Array up to 20 strings up to 500; cannot bypass numeric limits |
| financial.totalBudget | Positive exact decimal string, lifetime spend plus reservations |
| financial.perPaymentLimit | Positive exact decimal string, maximum one payment |
| financial.periodBudget | Positive exact decimal string, current-period spend plus reservations |
| financial.periodSeconds | Integer 60–31,536,000; elapsed seconds, not calendar months |
| financial.validFrom | Nonnegative integer Unix seconds |
| financial.validUntil | Positive integer Unix seconds greater than validFrom |
| merchants | Array 1–32 distinct recipient records |
| merchants[].name | String 1–100 |
| merchants[].recipient | 0x followed by 40 hexadecimal digits |
| merchants[].origins | Array 1–10 public HTTPS origins, no path/query/fragment |
| merchants[].products | Array up to 30 strings up to 200 |
| evidence.requiredTypes | Array 1–10 strings of 1–200 |
| evidence.approvedOrigins | Array 1–30 public HTTPS origins |
| evidence.maxAgeSeconds | Integer 1–31,536,000 |
| criteria | Array 1–12 required checks; each must PASS |
| criteria[].id | Unique 1–40 alphanumeric/underscore/hyphen |
| criteria[].description | String 3–1,000 |

Unknown policy fields are rejected. Lifetime/per-payment/period relationships are validated. Policies are immutable after activation; changing merchants, budgets or criteria requires a new vault. Pause and permanent revocation change enabled state, not the mandate. Funding is independent of permission.

The current token uses six decimals. One token = 1,000,000 atomic units. All amounts are strings matching (0|[1-9][0-9]*)(.[0-9]{1,6})? with a literal decimal point and positive atomic value ≤18,446,744,073,709,551,615. No scientific notation, leading zeroes, negative values, JSON numbers or more than six fractional places. Maximum decimal value is 18446744073709.551615. Use bigint atomic arithmetic; never JavaScript floating point for funds.

## Payment input and response

PaymentInput is a strict object:

| Field | Type |
|---|---|
| recipient | EVM address approved by the policy |
| amount | Positive exact decimal string, six fractional places maximum |
| purchaseDescription | String 3–2,000 |
| justification | String 3–6,000; omitted from public explorer |
| category | String 1–200; checked against policy |
| invoiceId | String 1–200; merchant-issued |
| evidence | Array 1–8 unique public HTTPS evidence references |
| evidence[].url | Public HTTPS URL up to 2,048 |
| evidence[].sha256 | Optional 64-hex content digest, optional 0x prefix |

Headers: Authorization, Content-Type: application/json, Idempotency-Key (1–128 printable ASCII characters). Transport body ≤32 KiB; canonical payment ≤14 KiB. Every rejected admission leaves no payment operation; an admitted operation may later BLOCK, REJECT, require evidence, expire or cancel.

GET response RequestView includes id, cardId, cardName, status, original request, requestHash, evidenceHash, guard?, review?, genLayerTxHash?, paymentTxHash?, error?, createdAt and updatedAt (Unix milliseconds). Optional fields are absent until meaningful; do not require a pending request to contain review or payment hashes. guard contains allow:boolean, failures:string[], txHash?. review contains policyHash, requestHash, evidenceHash, decision, reason and criteria[{id,status,reason,sources}]. RequestView's reviewStage distinguishes pending, completed, skipped and failed evaluation.

## Merchant evidence

Required invoice object (all nine fields, no unknown fields):

```json
{
  "invoiceId": "<same-id-as-payment>",
  "buyer": "<agent-vault-address>",
  "token": "<configured-six-decimal-token>",
  "chainId": 1952,
  "recipient": "<same-approved-recipient>",
  "amount": "1.000001",
  "description": "<actual-deliverable>",
  "issuedAt": 1792886400,
  "expiresAt": 1792890000
}
```

The timestamps above illustrate integer seconds only; request a fresh invoice with actual current timestamps. Chain/token come from /config. invoiceId, buyer, recipient, exact amount, source origin, issue time, freshness and expiry must agree. The invoice source must be an origin associated with the approved merchant recipient. Supporting evidence uses approved evidence origins.

Serve stable accessible UTF-8 application/json or text/*. The fetcher rejects private/local IPs, credentials, redirects, non-text responses and unsupported schemes; public DNS is pinned. Each source ≤64 KiB, total content ≤128 KiB. Bytes must remain unchanged through consensus. Optional digest pins and the GenLayer refetch must match original SHA256. Expiry is bounded by the invoice, policy and maximum 24-hour authorization.

A source's hash proves unchanged bytes; an approved origin establishes configured provenance. Neither proves a merchant's claims are objectively true. Prompt injection in source text is untrusted data and must not be executed as instructions.

The configured reference merchant route is POST /demo/invoices with its separate administrator key and {buyer,amount,description}; it returns 201 {invoice,url}. This name is a legacy testnet route, not fabricated UI data. Records enter the UI only after actual submission/use. Public GET /demo/invoices/{id} serves the issued content; agent keys cannot issue it.

## State model

| State | Terminal | Meaning and next action |
|---|---|---|
| QUEUED | No | Durable admission; worker pending |
| RESERVED | No | Exact amount reserved onchain |
| REVIEWING | No | Semantic review processing |
| AWAITING_FINALITY | No | GenLayer call awaiting successful finalized consensus |
| APPROVED | No | Verified approval; transfer still pending |
| RETRYING | No | Recoverable worker error; resume same record |
| PAID | Yes | Exact reserved amount transferred to stored recipient |
| BLOCKED | Yes | Numeric/recipient/asset/enabled/time gate denied; review skipped |
| REJECTED | Yes | Finalized REJECT; reservation released |
| NEEDS_EVIDENCE | Yes | Missing/inaccessible/mismatched evidence or finalized insufficient decision |
| EXPIRED | Yes | Expired authorization; reservation released |
| CANCELLED | Yes | Owner/key cancellation or terminal consensus/VM failure; no transfer |

Review decisions APPROVE/REJECT/NEEDS_EVIDENCE differ from payment states. Criteria PASS/FAIL/INSUFFICIENT differ from guard allow. Any criterion FAIL rejects; any INSUFFICIENT without FAIL requires evidence; all PASS allows approval.

A request blocked before semantic review has reviewStage SKIPPED, not PENDING. A submitted review that terminally fails has FAILED, not a fabricated rejection explanation. NEEDS_EVIDENCE before review has no finalized GenLayer decision. Public reasoningSource is genlayer-finalized-contract only after independently reading the exact successful finalized contract result and matching stored commitments; pending, skipped, failed and unavailable have no verified reasoning.

## Errors and retry discipline

The machine error envelope is additive:

```json
{"error":{"code":"IDEMPOTENCY_CONFLICT","message":"This key was already used for different payment details","retryable":false,"requestId":"<correlation-id>"}}
```

Errors may include details (field validation context). X-Request-Id correlates a request. Retry-After appears when retry is appropriate; honor it, but do not generate a new operation key.

| HTTP | Typical codes | Action |
|---|---|---|
| 400 | INVALID_JSON / malformed request | Correct transport JSON |
| 401 | KEY_REQUIRED, KEY_REVOKED, KEY_INVALID, LOGIN_REQUIRED, CHALLENGE_EXPIRED, CHALLENGE_USED, INVALID_SIGNATURE | Supply valid agent credential or authenticate owner |
| 403 | ORIGIN_DENIED | Keep owner writes in the legitimate app origin |
| 404 | NOT_FOUND | Check ID and caller scope |
| 405 | METHOD_NOT_ALLOWED | Use the documented method |
| 409 | IDEMPOTENCY_CONFLICT, REVIEWER_PENDING, REVIEWER_FAILED, CARD_DISABLED, POLICY_NOT_FINAL, REVIEWER_RETRY_PENDING | Inspect code; wait, owner retry or correct the operation |
| 413 | BODY_TOO_LARGE | Reduce request payload |
| 415 | UNSUPPORTED_MEDIA_TYPE | Use Content-Type: application/json |
| 422 | INVALID_INPUT, EVIDENCE_ORIGIN, ACTIVATION_INVALID, INPUT_TOO_LARGE, IDEMPOTENCY_REQUIRED | Correct field/type/schema; never retry unchanged indefinitely |
| 429 | RATE_LIMIT | Back off; fixed minute quota |
| 503 | UNAVAILABLE, NOT_CONFIGURED | Service/dependency unavailable; bounded retry of same operation |

Use the actual returned code; not every 409 is retryable. HTTP codes describe transport/admission, payment states describe asynchronous outcomes. No artificial redirect statuses are used for financial decisions.

Authenticated responses expose RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (seconds to next fixed minute) and RateLimit-Policy. Limits: one active credential 60 calls per fixed UTC minute (GET and POST share); owner 120; login challenge 10 per owner address. Poll every five seconds in one loop. On unexpected loss of a POST response, resubmit identical input with the same operation key. Stop bounded polling at its deadline and keep the request ID. Never call a new payment just to resolve a timeout.

Admission ID = SHA256(canonical({cardId,idempotency})). Canonical input hash must match on retry. The vault separately commits lowercase recipient plus invoiceId, preventing duplicate pending/paid invoices across distinct operation keys. Persisted signed bytes before broadcast prevent duplicate sends after runner restart.

## Owner endpoints and controls

Paths relative to /api/v1:

| Endpoint | Payload/result |
|---|---|
| POST /owner/drafts | {description,guidance?} → 202 {id,status} |
| GET /owner/drafts/{id} | state/status/policy/questions/interpretation/activation? |
| GET /owner/cards | {cards:CardView[]} with actual contract views |
| POST /owner/cards | {draftId,cardAddress,activationTx} → verified registration |
| POST /owner/cards/{id}/reviewer | Retry only FAILED initialization → 202; preserves vault/policy |
| POST /owner/cards/{id}/keys | Issue/rotate → 201 {apiKey}, reveal once |
| DELETE /owner/cards/{id}/keys | Revoke credential → 204 and cancel invalid-key pending requests |
| GET /owner/requests | {requests:RequestView[]} |
| GET /owner/requests/{id} | Owned request detail |

Activation, funding, pause/resume, cancel, revoke and withdrawal are owner wallet transactions. See contracts/evm/src/AgentSpendingCard.sol and apps/web/components/client.ts for ABI/exact calls. Withdrawal uses actual unreserved tokens; a pending reservation cannot be withdrawn. Revoked vaults cannot resume. Always verify the configured chain/factory/token and wallet signature.

## Public explorer and ATM cards

GET /explorer/agents and /explorer/transactions return arrays and nextCursor. limit is integer 1–50 (default 20); cursor is opaque. Transactions support agentId and status filters. Ordering is createdAt descending, then id descending. Pass nextCursor as-is, preserve filters, stop when null. There is no synthetic activity feed.

GET /explorer/transactions/{id} returns {transaction,agent,reasoningSource,reviewStage}. Public fields omit original justification, keys, session tokens, snapshot content and signed transaction bytes. Owner policy/mission, addresses, amounts and cited reasoning are public; do not include private information in a published mandate.

GET /explorer/agents/{id}/card returns {agent,usage,shareUrl}. usage includes requestCount, paidCount, blockedCount, rejectedCount, needsEvidenceCount, cancelledCount, activeCount, fundsMoved (exact token decimal string), token, chainId, asOf. Counts represent actual admitted request records, including failed requests, not raw HTTP retries. fundsMoved sums only PAID records, not attempted/approved/reserved amounts. Balances are separate live contract views.

GET /explorer/agents/{id}/card.svg downloads a standalone SVG ATM identity snapshot. The UI also exports PNG and opens an X composer with the public share link. Attach the downloaded image manually; URL intent cannot attach an image binary. A card is an as-of snapshot and public identity, not a private key, token, NFT, payment authorization or cryptographic proof of solvency.

## TapeOut, GenLayer and trust boundaries

The mandatory TapeOut gate is a generated 1,766-NAND, 451-input, 8-output, zero-state circuit. Inputs encode exact uint64 amount/per-payment/lifetime/period/time and recipient/asset/enabled flags. The vault invokes it before reservation and again at settlement. An absent, changed or failing processor/circuit cannot be bypassed by a model approval.

The live X Layer testnet processor is TESTNET_ADAPTER_UNMODIFIED_TAPEOUT_NETLIST_VM. It executes the unchanged TapeOut NetlistVM. Circuit bytes/hash, metadata, processor implementation and bytecode are pinned. This uses TapeOut circuit execution and onchain X Layer data; it is not a claim of deployment to the official mainnet TapeOut CPU registry or X Layer DeWEB. Current pins and transaction evidence live in docs/deployments/testnet.json.

GenLayer permission interpreter proposes terms, and immutable per-vault PurchaseReviewer checks evidence and criteria. Optimistic Democracy uses validators and model-based validation with possible appeals. Model/validator participation depends on network configuration and round; there is no unconditional promise of exactly five LLMs or impossible hallucination. Finality/source/constructor/policy/argument/operator checks fail closed. Consensus failure cannot produce a release.

Newly initialized reviewers use source version 2: deterministic permission failures and missing proof resolve before model evaluation, and validators independently reproduce those checks without asking a model to override them. Semantic approvals still require model validation. Existing version 1 reviewers retain their pinned source and are not silently migrated; the legacy semantic consensus reliability findings remain applicable.

X Layer does not natively verify GenLayer consensus. It trusts the configured attestor's EIP-712 release for that foreign-chain decision. Gateway and attestor keys, contract upgrade/provenance pins, worker code, MongoDB durable state, RPC availability and merchant honesty are explicit dependencies. Onchain budget constraints remain effective even if semantic approval is wrong, within their declared numerical scope.

## Worker operations

GitHub Actions runs the live signing worker; the API never exposes its keys or runs a local live worker. Admitted drafts, cards and payments are durable MongoDB records. Submission and pending-record reads request an Actions wake with durable trigger lease, cooldown, workflow/ref verification, heartbeat/deadline and bounded-run continuation. A schedule remains a recovery path; Actions startup/finality have real latency, not instant guarantees.

The worker claims leased jobs, rotates fairly across proposal, finality, reviewer and payment queues, persists signed transaction bytes before broadcast, reconciles receipts after restarts and stops on terminal consensus/VM failure. A continuous finality or processing wait exceeding 30 minutes becomes PROCESSING_TIMEOUT. Drafts and reviewer initialization become FAILED; payments retain cancellation intent until release is confirmed rather than reporting a completed cancellation early. Cancellation intent persists until reservation release is confirmed. Paid/terminal records are not retried. A failed reviewer can be retried by its owner; source changes must preserve versioned validation for existing reviewers, not silently invalidate old cards.

If stuck: read the actual phase/error, inspect the corresponding GenLayer hash, confirm Actions workflow runs/secrets and RPC health, and resume the same record. Do not repeatedly activate vaults or issue new operation keys. The owner can cancel a reserved operation if appropriate.

## Agent skill and MCP setup

Install the repository skill:
```sh
npx skills add TS-mfon/intentguard --skill intentguard
```
The skill includes a local protocol reference. Set INTENTGUARD_BASE_URL and INTENTGUARD_API_KEY externally. It never asks an agent to reveal a credential.

Run the bundled MCP from a checkout:
```sh
git clone https://github.com/TS-mfon/intentguard.git
cd intentguard
npm ci --ignore-scripts --prefix packages/mcp
node packages/mcp/src/cli.mjs
```
This is an unpublished private package; do not run npx @intentguard/mcp as if it were published.

MCP configuration (replace path; supply the secret through your client's secure environment):
```json
{
  "mcpServers": {
    "intentguard": {
      "command": "node",
      "args": ["/absolute/path/intentguard/packages/mcp/src/cli.mjs"],
      "env": {
        "INTENTGUARD_BASE_URL": "https://intentguard-tapeout.vercel.app",
        "INTENTGUARD_API_KEY": "<secret-from-owner>"
      }
    }
  }
}
```
Do not commit this secret-bearing configuration. Public tools work without a key.

Resources: intentguard://protocol (this document), intentguard://openapi. Prompt: payment_integration(task). Tools: get_config, get_my_agent, submit_payment, get_payment, wait_for_payment, list_agents, list_transactions, get_transaction, get_agent_card. submit_payment is the only payment-admission mutation; it never silently retries. wait_for_payment is bounded to 45 seconds and returns the same pending operation ID. Errors return isError and structured {ok:false,error}; success is {ok:true,status,data}.

The TypeScript SDK is source in packages/sdk/index.ts; import it from your checkout or vendor the source and shared types. It is not an independently published npm package. IntentGuardError retains status/code/retryable/requestId/retryAfterSeconds/details. wait accepts timeoutMs, intervalMs and AbortSignal; timeout does not cancel an operation.

## Deployment and verification references

- docs/openapi.json: machine schema.
- docs/deployments/testnet.json: contract addresses, pins and real deployment receipts.
- docs/ACTIONS-WORKER.md: workflow operations.
- docs/CONTRACT.md: component interfaces.
- docs/ARCHITECTURE.md: trust model.
- docs/TESTNET.md: deployed testnet details.
- docs/AUDIT-12-FINDINGS.md: real 12-request audit, including safe cancellation in unresolved semantic consensus cases.
- .env.example: configuration names, never actual keys.

Verification must distinguish local fixtures from live evidence. Run types, core/API/worker tests, circuit/EVM/GenLayer checks, SDK/OpenAPI checks, MCP stdio tests, browser checks and hosted independent API/chain checks. A green build does not prove every semantic verdict: report unresolved GenLayer reliability separately.
