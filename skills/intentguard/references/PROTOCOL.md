# IntentGuard protocol integration manual

Version 0.3. Testnet deployment. Canonical application: https://intentguard-tapeout.vercel.app. API base: https://intentguard-tapeout.vercel.app/api/v1.

This document is bundled with the MCP server and agent skill. An integration can be built from this file and the bundled OpenAPI without visiting the website.

## Purpose and delivery semantics

An owner issues an immutable spending mandate to one agent vault. The agent requests payments with its own bearer credential. TapeOut enforces numerical and permission boundaries on X Layer; GenLayer reviews merchant evidence and mission fit. The worker settles only a successful finalized approval. HTTP 202 acknowledges a durable operation. **Only payment status PAID confirms the requested token transfer.** APPROVED is awaiting settlement.

New cards hold Circle-issued native testnet USDC on X Layer Testnet (1952), with immutable permitted destinations1952,84532(Base Sepolia) and421614(Arbitrum Sepolia). Existing cards retain synthetic TEST-USDT. All testnet assets have no monetary value. Semantic review uses GenLayer Studionet (61999). Query GET /config and /me before integrating. Never substitute X Layer mainnet (196), mainnet USDT, or a wallet's current chain without matching the configured deployment.

## Quick integration

1. A human connects their EVM wallet at /agent-setup, signs the single-use authentication challenge and proposes a complete mandate.
2. The human reviews the successfully finalized typed policy, activates the exact factory configuration on X Layer Testnet and registers the confirmed vault.
3. Fund the source vault with its actual /me.card.token on X Layer. New USDC cards use owner-approved spending networks; global /config.token stays legacy TEST-USDT. Wait for setupState READY, reviewer source/policy verification and onchain ACTIVE status. Funding alone does not imply readiness.
4. The human issues an agent API key. It is revealed once. Put it in INTENTGUARD_API_KEY in a secret manager or process environment. The API stores a hash.
5. GET /me using Authorization: Bearer <key>. Read the actual policy, chain, token, card address, balances, merchant recipients, approved origins and criteria.
6. Obtain a real merchant invoice naming the **vault address as buyer**. For CCTP requests, invoice.chainId/token identify destination USDC, not the source token. Owner-wallet buyer, stale invoices, unsupported origins, wrong token, wrong chain and mismatched amounts cannot be paid.
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

The proposal input is {"description":string,"guidance":object?,"settlement":Settlement?}; description 10–12,000 characters, complete canonical input at most 16 KiB. Guidance can express the complete policy below; the intelligent contract proposes typed terms which the human must review.

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
| destinationChainId | Optional positive EVM chain ID, defaults to source; must be in the owner-approved settlement destinations |
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

GET response RequestView includes id, cardId, cardName, status, original request, requestHash, evidenceHash, guard?, review?, genLayerTxHash?, paymentTxHash?, error?, createdAt and updatedAt (Unix milliseconds). The additive fields paymentSymbol, errorCode and bridge describe the actual asset and asynchronous CCTP progress. Optional fields are absent until meaningful; do not require a pending request to contain review or payment hashes. guard contains allow:boolean, failures:string[], txHash?. review contains policyHash, requestHash, evidenceHash, decision, reason and criteria[{id,status,reason,sources}]. RequestView's reviewStage distinguishes pending, completed, skipped and failed evaluation.

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

The timestamps above illustrate integer seconds only; request a fresh invoice with actual current timestamps. For direct payments chain/token come from /me.card; for CCTP invoices they come from the chosen /config.spendingNetworks entry. invoiceId, buyer, recipient, exact amount, source origin, issue time, freshness and expiry must agree. The invoice source must be an origin associated with the approved merchant recipient. Supporting evidence uses approved evidence origins.

Serve stable accessible UTF-8 application/json or text/*. The fetcher rejects private/local IPs, credentials, redirects, non-text responses and unsupported schemes; public DNS is pinned. Each source ≤64 KiB, total content ≤128 KiB. Bytes must remain unchanged through consensus. Optional digest pins and the GenLayer refetch must match original SHA256. Expiry is bounded by the invoice, policy and maximum 24-hour authorization.

A source's hash proves unchanged bytes; an approved origin establishes configured provenance. Neither proves a merchant's claims are objectively true. Prompt injection in source text is untrusted data and must not be executed as instructions.

The configured reference merchant route is POST /demo/invoices with its separate administrator key and {buyer,amount,description,chainId?,token?}; chainId/token must be supplied together for official destination USDC, or both omitted for legacy invoices; it returns 201 {invoice,url}. This name is a legacy testnet route, not fabricated UI data. Records enter the UI only after actual submission/use. Public GET /demo/invoices/{id} serves the issued content; agent keys cannot issue it.

## State model

| State | Terminal | Meaning and next action |
|---|---|---|
| QUEUED | No | Durable admission; worker pending |
| RESERVED | No | Exact amount reserved onchain |
| REVIEWING | No | Semantic review processing |
| AWAITING_FINALITY | No | GenLayer call awaiting successful finalized consensus |
| APPROVED | No | Verified approval; transfer still pending |
| RETRYING | No | Recoverable worker error; resume same record |
| BRIDGING | No | Authorized source USDC burn; destination not delivered yet |
| AWAITING_ATTESTATION | No | Existing burn awaits Circle standard-transfer attestation |
| MINTING | No | Destination receive/discovery or source receipt acknowledgement pending |
| PAID | Yes | Direct token receipt or exact destination USDC mint plus source acknowledgement verified |
| BLOCKED | Yes | Numeric/recipient/asset/enabled/time gate denied; review skipped |
| REJECTED | Yes | Finalized REJECT; reservation released |
| NEEDS_EVIDENCE | Yes | Missing/inaccessible/mismatched evidence or finalized insufficient decision |
| EXPIRED | Yes | Expired authorization; reservation released |
| CANCELLED | Yes | Owner/key cancellation or terminal consensus/VM failure; no transfer |

Review decisions APPROVE/REJECT/NEEDS_EVIDENCE differ from payment states. Criteria PASS/FAIL/INSUFFICIENT differ from guard allow. Any criterion FAIL rejects; any INSUFFICIENT without FAIL requires evidence; all PASS allows approval.

A request blocked before semantic review has reviewStage SKIPPED, not PENDING. A submitted review that terminally fails has FAILED, not a fabricated rejection explanation. NEEDS_EVIDENCE before review has no finalized GenLayer decision. Public reasoningSource is genlayer-finalized-contract only after independently reading the exact successful finalized contract result and matching stored commitments; pending, skipped, failed and unavailable have no verified reasoning.

## Native USDC settlement and CCTP integration

The owner funding flow is **X Layer deposit → merchant spending on approved testnets**. These are the complete supported native-USDC routes:

| Testnet | EVM chain ID | CCTP domain | Native USDC |
|---|---|---|---|
| X Layer | 1952 | 37 | `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3` |
| Base Sepolia | 84532 | 6 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Arbitrum Sepolia | 421614 | 3 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

All three tokens are native issuer-deployed testnet USDC with six decimals and no monetary value. A CCTP domain is distinct from the EVM chain ID sent to the API. This release supports this allowlist; it does not advertise arbitrary networks.

**USDT0 is disabled:** the supplied `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` is the issuer's X Layer mainnet chain 196 deployment and returned no code on chain 1952. The official testnet deployment API returned no entry. Enabling it requires an official testnet token, test-token source and supported peer registration. USDT0's LayerZero OFT path is separate from native-USDC CCTP; no testnet registration is inferred or mocked. USDT was removed from this phase.

GET /config publishes assets (asset,symbol,chainId,decimals,token,available,reason,sources), spendingNetworks (chainId,name,domain,token,explorerUrl) and cctpFactoryAddress. A null factory means native-USDC activation is unavailable even if issuer routes are verified. Legacy config.token/paymentSymbol remain TEST-USDT compatibility fields. Use /me.card.token/paymentSymbol/chainId/settlement to identify the actual agent asset. Existing TEST-USDT agents keep their original immutable token, factory and reviewer; no silent migration occurs.

New draft input adds settlement={"asset":"USDC","destinationChainIds":[1952,84532,421614]}. The subset must be nonempty, unique and limited to those IDs; the server sorts it before commitment. Include1952 to permit direct X Layer spending. The human reviews this selection alongside the finalized policy. Activation.kind=CCTP_V2 selects the new factory and destinationDomains37/6/3. The API verifies the actual factory/token/allowed domains; the V3 GenLayer reviewer verifies the immutable settlement hash and request destination. Omitted settlement preserves legacy drafts.

Fund the vault using its actual native source token, after obtaining X Layer testnet USDC from an issuer faucet or existing balance. Do not call the TEST-USDT mint function on an issuer token. Circle's public faucet is https://faucet.circle.com; the user-provided native-gas faucet is https://web3.okx.com/xlayer/faucet/xlayerfaucet. If a faucet only offers another supported testnet, use a documented issuer route and independently verify source arrival before funding. Source USDC and native test OKB gas are independent of destination relayer gas. Deposits cannot increase immutable spending permission.

PaymentInput adds optional destinationChainId; it defaults to the card's source chain. For Base send84532, for Arbitrum421614, never domain 6/3. Read the approved subset from /me and destination token from spendingNetworks. A legacy agent permits only its source chain. Unsupported or unapproved destinations fail before durable admission (HTTP 422 DESTINATION_NOT_ALLOWED). Invoice buyer remains the source vault; invoice.chainId/token match destination USDC.

The reference merchant administrator may issue {buyer,amount,description,chainId,token}. Provide chainId+token together; a partial pair yields422 INVOICE_ASSET_REQUIRED, a nonofficial pair yields ASSET_OR_ROUTE_UNSUPPORTED. Agent keys cannot issue invoices. All ordinary approved-origin, invoice-ID, exact amount, freshness, description and stable evidence constraints continue to apply.

Example SDK integration using real owner-approved values:

```ts
const capabilities = await ig.capabilities();
const { card } = await ig.me();
const destinationChainId = 84532; // Only if the owner approved Base Sepolia.
const network = capabilities.spendingNetworks.find(n => n.chainId === destinationChainId);
if (!network || !card.settlement?.destinationChainIds.includes(destinationChainId))
  throw new Error("Owner did not approve this route");
// Obtain a real merchant invoice with:
// buyer=card.address, chainId=destinationChainId, token=network.token.
const queued = await ig.request({
  destinationChainId,
  recipient: "<APPROVED_MERCHANT_ADDRESS>",
  amount: "<EXACT_POSITIVE_DECIMAL>",
  purchaseDescription: "<ACTUAL_DELIVERABLE>",
  justification: "<MISSION_FIT>",
  category: "<PERMITTED_CATEGORY>",
  invoiceId: "<FRESH_MERCHANT_INVOICE_ID>",
  evidence: [{url: "https://<APPROVED_HOST>/invoice.json"}]
}, "<STABLE_OPERATION_KEY>");
```

TapeOut reservation and settlement checks, committed public evidence and a successful finalized GenLayer approval precede a CCTP source burn. The signed release binds destination, merchant, amount and exact message route to policy/request/evidence/decision. Standard transfer uses minFinalityThreshold=2000,maxFee=0,destinationCaller=0 and no hook data. Fees are never silently subtracted: a required source fee change disables new burns until explicit fee-aware support exists.

The source vault burns USDC through official Circle TokenMessengerV2. Source MessageSent plus BridgeStarted events are verified. Iris V2 GET https://iris-api-sandbox.circle.com/v2/messages/37?transactionHash=<sourceHash> supplies public attestations without an API key. The worker validates raw bytes and immutable fields against the source receipt. Iris fills nonce and executed-finality fields offchain, so full source/attested byte equality is incorrect. Source hash, domains, both messengers, source token, vault, merchant, amount, fees, finality and hook constraints remain bound.

Destination MessageTransmitterV2 verifies Circle's signature. The worker independently verifies the exact consumed nonce/message and native-USDC mint to the approved merchant. A transaction hash or success receipt without these matching events is not sufficient. The source vault's receipt acknowledgement is a separate transaction.

RequestView.bridge contains protocol=CCTP_V2,phase(BURNED,ATTESTATION_PENDING,ATTESTED,MINT_SUBMITTED,CONFIRMED),sourceChainId,destinationChainId,destinationDomain,sourceToken,destinationToken,amount,sourceTxHash,updatedAt and optional messageHash,nonce,destinationTxHash,confirmationTxHash. The object is absent before verified source burn. APPROVED,BRIDGING,AWAITING_ATTESTATION and MINTING are nonterminal. **PAID requires verified destination mint plus source-vault acknowledgement.** For CCTP paymentTxHash is the destination receipt; source burn/acknowledgement remain separate in bridge. Open each hash on its actual chain.

A confirmed burn consumes lifetime and original-period spending permission before merchant delivery. balances.spent includes burned amounts; downloadable fundsMoved excludes pending delivery. An existing burn cannot be cancelled, expired, refunded or repeated through owner/key controls. Key revocation, pause/revoke, cancellation intent, gas shortage, RPC/Iris errors and Actions interruptions keep its reconciliation durable. Signed source/destination transactions are saved before broadcast; nonce consumption and receipts are reconciled without a second burn. The original invoice remains committed.

Native-USDC card EIP712 domain version 2 distinguishes it from legacy domain version 1. BridgeRelease adds routeHash=keccak256(abi.encode(uint32 destinationDomain,bytes32 mintRecipient,uint64 amount,uint256 maxFee=0,uint32 finality 2000,bytes32 destinationCaller=0)). BridgeReceipt binds requestId,requestHash,routeHash,sourceTxHash,destinationTxHash,messageHash,amount. Direct payments on the new card retain the Release field shape with domain version 2.

The source vault verifies the receipt-attestor signature. **X Layer does not independently verify foreign-chain receipt consensus.** Circle's destination attestation verification and IntentGuard's receipt-attestor/RPC trust are distinct boundaries; a compromised receipt attestor can falsely acknowledge delivery within the immutable route commitments.

Asynchronous codes such as CCTP_ATTESTATION_UNAVAILABLE,CCTP_RATE_LIMIT,DESTINATION_GAS_REQUIRED,BRIDGE_COMMITMENT_MISMATCH and BRIDGE_RECEIPT_UNAVAILABLE are exposed in errorCode. Technical mismatch may require operator investigation of the same operation, never a replacement burn. Standard finality plus Actions scheduling can take minutes. Preserve the existing ID and Idempotency-Key if bounded SDK/MCP polling ends first; timeout is not cancellation or permission to create another payment.

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
| 422 | INVALID_INPUT, EVIDENCE_ORIGIN, ACTIVATION_INVALID, INPUT_TOO_LARGE, IDEMPOTENCY_REQUIRED, DESTINATION_NOT_ALLOWED, ASSET_OR_ROUTE_UNSUPPORTED, INVOICE_ASSET_REQUIRED | Correct field/type/schema; never retry unchanged indefinitely |
| 429 | RATE_LIMIT | Back off; fixed minute quota |
| 503 | UNAVAILABLE, NOT_CONFIGURED, BRIDGE_NOT_CONFIGURED | Service/dependency unavailable; bounded retry of same operation |

Use the actual returned code; not every 409 is retryable. HTTP codes describe transport/admission, payment states describe asynchronous outcomes. No artificial redirect statuses are used for financial decisions.

Authenticated responses expose RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (seconds to next fixed minute) and RateLimit-Policy. Limits: one active credential 60 calls per fixed UTC minute (GET and POST share); owner 120; login challenge 10 per owner address. Poll every five seconds in one loop. On unexpected loss of a POST response, resubmit identical input with the same operation key. Stop bounded polling at its deadline and keep the request ID. Never call a new payment just to resolve a timeout.

Admission ID = SHA256(canonical({cardId,idempotency})). Canonical input hash must match on retry. The vault separately commits lowercase recipient plus invoiceId, preventing duplicate pending/paid invoices across distinct operation keys. Persisted signed bytes before broadcast prevent duplicate sends after runner restart.

## Owner endpoints and controls

Paths relative to /api/v1:

| Endpoint | Payload/result |
|---|---|
| POST /owner/drafts | {description,guidance?,settlement?} → 202 {id,status} |
| GET /owner/drafts/{id} | state/status/policy/questions/interpretation/activation? |
| GET /owner/cards | {cards:CardView[]} with actual contract views |
| POST /owner/cards | {draftId,cardAddress,activationTx} → verified registration |
| POST /owner/cards/{id}/reviewer | Retry only FAILED initialization → 202; preserves vault/policy |
| POST /owner/cards/{id}/keys | Issue/rotate → 201 {apiKey}, reveal once |
| DELETE /owner/cards/{id}/keys | Revoke credential → 204; cancel unburned/unpaid requests; existing burns continue recovery |
| GET /owner/requests | {requests:RequestView[]} |
| GET /owner/requests/{id} | Owned request detail |

Activation, funding, pause/resume, cancel, revoke and withdrawal are owner wallet transactions. See contracts/evm/src/AgentSpendingCard.sol and apps/web/components/client.ts for ABI/exact calls. Withdrawal uses actual unreserved tokens; a pending reservation cannot be withdrawn. Revoked vaults cannot resume. Always verify the configured chain/factory/token and wallet signature.

## Public explorer and ATM cards

GET /explorer/agents and /explorer/transactions return arrays and nextCursor. limit is integer 1–50 (default 20); cursor is opaque. Transactions support agentId and status filters. Ordering is createdAt descending, then id descending. Pass nextCursor as-is, preserve filters, stop when null. There is no synthetic activity feed.

GET /explorer/transactions/{id} returns {transaction,agent,reasoningSource,reviewStage}. Public fields omit original justification, keys, session tokens, snapshot content and signed transaction bytes. Owner policy/mission, addresses, amounts and cited reasoning are public; do not include private information in a published mandate.

GET /explorer/agents/{id}/card returns {agent,usage,shareUrl}. usage includes requestCount, paidCount, blockedCount, rejectedCount, needsEvidenceCount, cancelledCount, activeCount, fundsMoved (exact token decimal string), token, chainId, asOf. Counts represent actual admitted request records, including failed requests, not raw HTTP retries. fundsMoved sums only PAID delivery, not attempted/approved/reserved/burned-but-undelivered amounts. activeCount includes bridge reconciliation. chainId/token identify the source vault; inspect each bridge for its actual delivery chain. Balances are separate live contract views.

GET /explorer/agents/{id}/card.svg downloads a standalone SVG ATM identity snapshot. The UI also exports PNG and opens an X composer with the public share link. Attach the downloaded image manually; URL intent cannot attach an image binary. A card is an as-of snapshot and public identity, not a private key, token, NFT, payment authorization or cryptographic proof of solvency.

## TapeOut, GenLayer and trust boundaries

The mandatory TapeOut gate is a generated 1,766-NAND, 451-input, 8-output, zero-state circuit. Inputs encode exact uint64 amount/per-payment/lifetime/period/time and recipient/asset/enabled flags. The vault invokes it before reservation and again at settlement. An absent, changed or failing processor/circuit cannot be bypassed by a model approval.

The live X Layer testnet processor is TESTNET_ADAPTER_UNMODIFIED_TAPEOUT_NETLIST_VM. It executes the unchanged TapeOut NetlistVM. Circuit bytes/hash, metadata, processor implementation and bytecode are pinned. This uses TapeOut circuit execution and onchain X Layer data; it is not a claim of deployment to the official mainnet TapeOut CPU registry or X Layer DeWEB. Current pins and transaction evidence live in docs/deployments/testnet.json.

GenLayer permission interpreter proposes terms, and immutable per-vault PurchaseReviewer checks evidence and criteria. Optimistic Democracy uses validators and model-based validation with possible appeals. Model/validator participation depends on network configuration and round; there is no unconditional promise of exactly five LLMs or impossible hallucination. Finality/source/constructor/policy/argument/operator checks fail closed. Consensus failure cannot produce a release.

New native-USDC reviewers use source version 3 and verify settlementHash, destination chain/token/domain and destination invoice against immutable source USDC plus approved routes. Existing version 2 and version 1 reviewers retain their pinned source. Version 2 reviewers use deterministic preflight: deterministic permission failures and missing proof resolve before model evaluation, and validators independently reproduce those checks without asking a model to override them. Semantic approvals still require model validation. Existing version 1 reviewers retain their pinned source and are not silently migrated; the legacy semantic consensus reliability findings remain applicable.

X Layer does not natively verify GenLayer consensus. It trusts the configured attestor's EIP-712 release for that foreign-chain decision. Gateway and attestor keys, contract upgrade/provenance pins, worker code, MongoDB durable state, RPC availability and merchant honesty are explicit dependencies. Onchain budget constraints remain effective even if semantic approval is wrong, within their declared numerical scope.

## Worker operations

GitHub Actions runs the live signing worker; the API never exposes its keys or runs a local live worker. Admitted drafts, cards and payments are durable MongoDB records. Submission and pending-record reads request an Actions wake with durable trigger lease, cooldown, workflow/ref verification, heartbeat/deadline and bounded-run continuation. A schedule remains a recovery path; Actions startup/finality have real latency, not instant guarantees.

The worker claims leased jobs, rotates fairly across proposal, finality, reviewer and payment queues, persists signed transaction bytes before broadcast, reconciles receipts after restarts and stops on terminal consensus/VM failure. A continuous finality or processing wait exceeding 30 minutes becomes PROCESSING_TIMEOUT. Drafts and reviewer initialization become FAILED; unburned payments retain cancellation intent until release is confirmed rather than reporting a completed cancellation early. Burned CCTP requests remain active for destination delivery and are not cancelled on processing deadlines. Cancellation intent persists until reservation release is confirmed. Paid/terminal records are not retried. A failed reviewer can be retried by its owner; source changes must preserve versioned validation for existing reviewers, not silently invalidate old cards.

If stuck: read the actual phase/error, inspect the corresponding GenLayer hash, confirm Actions workflow runs/secrets and RPC health, and resume the same record. Do not repeatedly activate vaults or issue new operation keys. The owner can cancel a reserved operation before payment/burn if appropriate. Existing burns must be reconciled to their destination; do not start a replacement payment.

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

The TypeScript SDK is source in packages/sdk/index.ts; import it from your checkout or vendor the source and shared types. It is not an independently published npm package. IntentGuardError retains status/code/retryable/requestId/retryAfterSeconds/details. capabilities() reads asset/network/factory discovery; me() identifies the actual card asset. request() accepts destinationChainId and wait() treats bridge states as pending. wait accepts timeoutMs, intervalMs and AbortSignal; timeout does not cancel an operation or source burn.

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
