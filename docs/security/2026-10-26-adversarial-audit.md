# Scoped adversarial audit — 26 October 2026

This is an internal source and controlled-runtime audit. It is **not** an independent third-party or TapeCode audit, certification of a deployed release, or a claim of zero vulnerabilities. Final live R12–R17 gates remain open until the release operator publishes fresh receipts.

Payments stay separated: X Layer testnet 1952 and X Layer mainnet 196. Both use GenLayer Studionet 61999 for **testnet** semantic review. Studionet's zero genesis hash and SDK consensus address are configuration pins, not proof of deployed EVM consensus code or robust reset detection.

## Scope and method

Reviewed owner authentication, API-key rotation, request admission, public evidence transport, immutable commitments, worker leases, GenLayer signed journals/finality, direct payment receipts, CCTP message/receipt/recovery, and EVM accounting/signatures. Attacks use local MemoryStore, controlled transports, signed fixture transactions and Forge contracts. No production exploit, private-network probe, real-value transaction, credential extraction or database attack was run.

The baseline was source commit `9d9eeb6`. Three original regression tests failed before remediation; a separate receipt attack failed while its valid-receipt control passed. The fetcher baseline was executed in a controlled transport harness and observed beyond its actual 12-second timeout. Fixes were followed by nearby negative variants and legitimate positive controls.

## Confirmed defects and repairs

| ID | Severity and scope | Before-fix evidence | Repair | Retest |
|---|---|---|---|---|
| S01 | Medium, environment-isolation defense | A signed testnet wallet challenge copied into a mainnet store authorized a mainnet session. The expected rejection failed. This assumes challenge records cross environments; no cross-database access was demonstrated. | Challenges persist payment-environment/chain credential scope; login requires it and atomically claims that same scope. Old unscoped challenges require reissuance. | Copy rejected; the original deployment still accepts its valid signature once. Existing session/key replay controls pass. |
| S02 | High, late revocation correctness | Revoking the credential and marking cancellation during the last asynchronous finality read still produced PAID. | Reload request, card, credential and immutable commitments after final review and before settlement. Cancel revoked/rotated requests, honor cancellation/expiry, and refuse changed policies, reviewer addresses, evidence or leases. | Revocation, rotation, cancellation and late expiry release reservation without settlement; changed commitments/leases never reach settlement; valid approval pays exactly once. |
| S03 | Medium, evidence-network guard bypass | Expanded `2001:0db8:...` notation bypassed textual reserved-prefix checks. Reserved address rejection failed. Reachable private-service exploitation was not demonstrated. | Parse numeric IPv6 words; allow global unicast only and reject special-purpose/transition/documentation ranges, IPv4 embeddings and zones. Tighten IPv4 reserved-range boundaries. | Expanded/compressed/zero-padded reserved vectors rejected; public Cloudflare/Google IPv6 and public IPv4 accepted. Mixed public/private DNS sets reject before transport. |
| S04 | Medium, worker availability | The baseline fetcher had an inactivity timeout only. A controlled response trickled bytes for over 12 seconds without a wall-clock abort. | Absolute 12-second deadline begins before DNS, destroys transport on failure, and cannot be extended by progress. Require identity encoding, valid UTF-8 and bounded content length/body. | Slow trickle and late DNS stop; no connection occurs after DNS deadline. Redirect, compression, invalid UTF-8, abrupt close and excess-size cases fail; complete public evidence succeeds. |
| S05 | High, delivery-proof integrity | A successful journal receipt with no Paid/Transfer events was accepted as PAID. Expected rejection failed; the exact-event positive control passed. No fund-draining exploit was demonstrated. | PAID requires a unique vault Paid event bound to request, decision, GenLayer transaction, recipient and amount, plus the exact configured-token Transfer from the vault. Check confirmations in settlement and recovery. | Unrelated receipt and mutations of token/vault/recipient/amount/decision, duplicate transfer and insufficient confirmations reject. Matching confirmed events succeed. |

Reproduction files: `tests/owner-challenge-security.test.ts`, `tests/settlement-authorization-security.test.ts`, `tests/evidence-address-security.test.ts`, `tests/evidence-security.test.ts`, `tests/payment-receipts.test.ts`. The baseline transport harness is `scripts/audit-production-baseline.ts`; it reads only the explicitly selected reviewed commit and performs no network request.

S06 — Medium, deadline enforcement: a reserved request whose processing had already exceeded 30 minutes still reached PAID after intermediate success reset the wait timer. The pre-fix deadline test failed with actual PAID versus expected CANCELLED. Reservation processing now records a durable start time; the worker checks that bound before review and again after the last finality read. Retry/progress cannot reset it. Late finality cancels before release with PROCESSING_TIMEOUT; completed burns retain reconciliation.

## Additional defenses and nearby attacks

Signed EVM journals must match their raw transaction hash, chain, target, calldata, zero value, signer and environment binding. CCTP recovered mint transactions apply the same validation. GenLayer recovery reconstructs the intended call without broadcasting and compares the saved signed intent even when a protocol hash was cached. Tests reject copied chains, altered calldata/targets/value and corrupted hash while allowing exact recovery. These are corruption/compromised-storage defenses; they are not evidence of remote database compromise.

Signing and broadcasting recheck the exact job lease after long RPC calls. Expired, replaced and missing leases refuse broadcasting. Once a transaction was already signed/broadcast, database credential revocation cannot undo it; owner onchain pause/revoke is the authoritative remaining control. Irreversible CCTP burns continue reconciliation after cancellation, expiry or owner revocation.

Consequential API, invoice and Iris JSON rejects duplicate object keys, including escaped duplicates. Ambiguous invoices cannot authorize reservation. API schemas still reject unrecognized owner/card fields and cross-owner credentials.

The 133-contract test suite exercises EIP-712 commitment mutations, chain/card/request replay, malformed/high-S signatures, recipient and budget bounds, period rollover, pause/revoke/withdraw, exact token debit/credit, token/issuer reentrancy, processor/beacon changes, route selection, bridge receipt mutations, irreversible-burn recovery and issuer fees/pauses. Three fuzz tests use 64 samples each. This is bounded test coverage, not formal verification.

## Owner replacement and recovery

`GET /api/v1/owner/cards/:id/replacement` requires the owning session and returns source environment/reviewer/policy, live accounting, pending count, bounded pending IDs, explicit steps and accounting-reset warnings.

`POST` requires the owning session, same-origin check, an explicit version-2 settlement in the current payment environment, and `acknowledgeAccountingReset: true`. Every selected route must be in the pinned verification manifest. It creates one idempotent exact-policy-copy draft with `replacesCardId` and source metadata. Wallet activation creates a new empty vault. The old reviewer, policy, vault, funds, requests and credentials are never rewritten or transferred by this endpoint.

The owner must revoke old credentials, pause the old vault, resolve reservations, finish irreversible bridge recovery, withdraw and deposit explicitly, activate the new vault and then issue a new credential. Lifetime budgets reset per new vault; copied numeric budgets apply to the explicitly selected asset. Replacement is not an invisible migration.

## CCTP proof artifacts

The worker durably stores the source burn receipt and original message, exact parsed Iris response, attested message and attestation, destination MessageReceived and native-USDC mint receipt, route/recipient/amount/domain/fee/finality checks, and the exact BridgeReceipt EIP-712 domain/types/message/digest/attestor. Optional historical balance reads are explicitly block-level and may include unrelated transfers; when archive reads are unavailable, the artifact says so and retains the exact mint Transfer proof.

`GET /api/v1/explorer/transactions/:id/proof` exposes the captured public proof and its commitment. It contains no private signing key, API credential or raw signed transaction. Old bridge records recapture missing Iris proof before completing. A worker-captured bundle remains subject to independent RPC/receipt verification.

The immutable attestor can still acknowledge false foreign-chain delivery if compromised. X Layer does not verify a foreign-chain light client. This architectural trust boundary is **open**; no unsupported rotation, multisig or light-client claim is made.

## Semantic release acceptance

`scripts/audit-production-semantic.ts` requires a dedicated audit credential, explicit operator execution, fresh fixtures with at least ten permitted, ten prohibited, ten prompt-injection and ten evidence-failure cases, plus budget and consensus-failure controls and matching live source commit/release/environment. It preserves machine-readable progress and distinguishes finalized rejection, evidence failure, financial block and consensus cancellation. It checks independently verified public contract reasoning, reservation release, spent ledger changes, and idempotent request/receipt stability. The API completion stage is COMPLETE; GenLayer transaction finality is verified independently. Thresholds match the original plan: same-chain p95 30 minutes, CCTP p95 60 minutes, queue and cancellation p95 10 minutes, pre-burn deadline 30 minutes, zero unexpected terminal outcomes. Each runner has a 70-minute per-request observation limit so delayed post-burn recovery is reported rather than mistaken for cancellation.

Local tests prove that the report validator refuses cancellation-as-rejection, admission/approval-as-payment and oversized latency samples. **The runner was not executed against a live deployment in this leaf.** Two independent live permitted/prohibited/prompt-injection/evidence/replay runs, deployed owner controls, consensus-failure release, and release-pinned external availability still belong to R12–R17.

## Remaining risk and evidence limits

- Studionet semantic consensus is testnet infrastructure protecting mainnet payments through the configured attestor.
- Semantic prompt-injection reliability needs fresh finalized live decisions; an expired-invoice denial is insufficient.
- Live RPC/issuer availability, key custody, Atlas principals/indexes/backups, DNS, dependency supply chain and deployed bytecode require release-level verification.
- No independent third-party/TapeCode audit completion is implied by this report.
- Finite adversarial tests cannot establish absence of all security flaws.

Reverification: `node tools/production/verify-security.mjs`. Its success token certifies only its declared local application/contract oracles; it does not close live gates.

## Focused remediation history

| Finding | Fix commit |
|---|---|
| S01 challenge scope | `3563134` |
| S02 late authorization | `e0d8ddd` |
| S03 IPv6 network guard | `bd6d986` |
| S04 absolute evidence deadline | `cbe579b` |
| S05 delivery receipt integrity | `94d4b45` |
| S06 durable processing deadline | `7298d03` |
| Signed journal and lease defenses | `1712acc` |
| Explicit owner replacement | `4d8a353` |
| Public CCTP proof and strict JSON | `b203b82` |

The parent independently reran the local application and contract oracles before publication, then split the regression cases into focused files without changing their assertions. Deployment and fresh live semantic acceptance are still pending.
