# Native-USDC CCTP live funds audit

Verified on 26 October 2026 against https://intentguard-tapeout.vercel.app. The requested deliverable was **funds**, following the user's correction of “fonts.”

## 1. Execution verdict

**SUCCESS for the supported native-USDC testnet flow: 8/8 audit scenarios matched.** GitHub Actions [run 40260466255](https://github.com/TS-mfon/intentguard/actions/runs/40260466255) completed successfully on code `e4d9b596d4a8c4b6ffe9e6afa5f91c6d699ca21c`. [Independent receipt verification](audits/cctp-independent.json) confirmed the one-USDC deposit, three exact deliveries, finalized reviews, unused reservations for preflight denials, consumed CCTP nonces, source acknowledgements, and accounting.

The owner deposited **1 USDC** into X Layer vault `0xB914C71A5667E816f248F6aaB41546200f2d43B1`. Each permitted merchant destination received **0.1 USDC**. Final spending is **0.3 USDC**, available vault balance **0.7 USDC**, and reserved balance **0**. All assets are issuer-deployed testnet USDC with no monetary value.

| Scenario | Admission HTTP | Expected and observed outcome | Delivery |
| --- | --- | --- | --- |
| X Layer 1952 | 202 | PAID after finalized approval | Exact 0.1 USDC direct transfer |
| Base Sepolia 84532 | 202 | PAID after burn, attestation, mint and acknowledgement | Exact 0.1 native destination USDC |
| Arbitrum Sepolia 421614 | 202 | PAID after burn, attestation, mint and acknowledgement | Exact 0.1 native destination USDC |
| Base mainnet 8453 | 422 | DESTINATION_NOT_ALLOWED before admission | No request, reservation or transfer |
| Over per-payment limit: 1.000001 USDC | 202 | BLOCKED, review SKIPPED | No reservation, review transaction or transfer |
| Personal data for advertising | 202 | REJECTED by finalized GenLayer review | Reservation released; no transfer |
| Invoice names owner rather than agent vault as buyer | 202 | NEEDS_EVIDENCE / INVOICE_BUYER_MISMATCH, review SKIPPED | No reservation, review transaction or transfer |
| Identical payload and Idempotency-Key replay | 202 | Original request ID returned | No extra request or payout |

HTTP 202 records admission; the terminal request status proves the business outcome. A pending burn was never labelled PAID.

## 2. Documentation assessment

**Information completeness: 4/5.** Read [the cross-chain section](https://intentguard-tapeout.vercel.app/docs/crosschain) before the audit. It describes source funding, issuer token addresses, testnet chain IDs versus CCTP domains, immutable owner-selected destinations, exact destination invoice fields, asynchronous states, and the attestor trust boundary. General docs and OpenAPI supply the bearer header, API prefix, decimal amount format, evidence schema, idempotency requirements, errors and response shapes. The published docs have 22 bounded sections.

### Ambiguity log

- `crosschain` must be read with `quickstart`, `evidence`, `agent-api` and `statuses`; a new agent cannot infer every invoice rule from the cross-chain example alone.
- The limit-denial response has structured `guard.failures` but no non-null `errorCode`. It is actionable through status and guard fields; integrations must not assume every non-PAID terminal outcome is an HTTP error or has a machine error code.
- Standard CCTP timing was stated as “minutes.” [Circle's finality reference](https://developers.circle.com/cctp/concepts/finality-and-block-confirmations.md) gives approximately 15–19 minutes of Ethereum finality after batch posting for X Layer. Actual latency also includes posting and worker scheduling.
- The vault `balances.funded` field is current token balance, not cumulative deposited funds. It decreases from 1 to 0.7 in this audit. Card `fundsMoved` measures confirmed delivery and excludes burns still pending.
- Time to grasp was **not independently timed**. Setup and waiting durations include contract/network checks and must not be presented as comprehension time.

### Quick fixes and follow-up

- Add a single linked checklist covering source-vault buyer, destination token/chain, invoice ID, exact amount, approved evidence origin and Idempotency-Key.
- State the documented 15–19-minute finality interval plus batch and scheduling delay; advise preserving the existing request ID when polling times out.
- Document the absence of `errorCode` for numeric blocks, or introduce a compatible machine-code field while preserving `guard.failures`.
- Distinguish current vault balance, cumulative deposits, spending consumed at burn and funds actually delivered.

These are integration-quality follow-ups, not failed audit outcomes.

## 3. API and endpoint feedback

Requests use standard JSON and `Authorization: Bearer <AGENT_KEY>` with `Idempotency-Key`. Amounts are exact decimal strings; destinations use EVM chain IDs, not Circle domains. Evidence names the public merchant invoice.

Wrong destination permissions fail before durable admission with HTTP 422 and `DESTINATION_NOT_ALLOWED`. A buyer mismatch is detected before reservation and exposes `INVOICE_BUYER_MISMATCH`. Numeric denials skip semantic review. Semantic rejection is a verified finalized contract result followed by reservation release.

The response format is suitable for automated callers: a stable request ID, terminal status, separate review stage, committed hashes and separate source/mint/acknowledgement receipts. APIs and SDK/MCP clients must preserve the original operation during polling expiry. **HTTP 202, APPROVED and a source burn do not prove merchant delivery.**

Hosted native-USDC checks at `2026-10-26T03:06:49.767Z` verified seven actual admitted records (including the retained failed attempt), three PAID outcomes, 0.3 USDC moved, a 1200×760 downloadable PNG, three real landing transactions, six transaction pages, finalized criterion reasoning, skipped review on preflight denials and correct explorer links. No browser page errors occurred. Invalid mainnet admission and the idempotent retry did not increase the request count.

## 4. Raw logs and exact receipts

[Complete masked raw API logs and request payloads](audits/cctp-live-results.json) contain each method, full URL, sent headers/body, admission response, terminal response and observed headers. Authentication and cookies are redacted. Credentials, encrypted API-key state and raw signed transaction journals are excluded.

[Independent chain/contract proof](audits/cctp-independent.json) and [hosted native-USDC logs](audits/cctp-hosted.json) provide separate evidence.

| Operation | Exact transaction hash |
| --- | --- |
| One-USDC X Layer deposit | `0xcdfb4b20bf59809c7fa42150a302d2a0c07cda862a187beb573ce8c3b91373b4` |
| X Layer direct payment | `0x1eddd97f31e87079057d0bd470a6aa1def42505e70228ab0e9797a98bb5949ef` |
| X Layer burn for Base | `0xd4a90e427691bd61c30c65e7f2ebc9aa5ca5a6ecc88f8097d89318a775762a09` |
| Base destination mint | `0xad5b416d9b82f208114e5ae5ea0a702f6add1f031d9b5183debf32aa343c94ea` |
| X Layer acknowledgement of Base delivery | `0x9077076442e89e597c2ead69a3d1cb62e6d5e3c90a7d978482b3bf8c35ed3ae9` |
| X Layer burn for Arbitrum | `0x4424112408b270826b32f73262df046c405d9b3e5b980d382e378ff5de529878` |
| Arbitrum destination mint | `0x188c42857338ca551531bf8d451921f170032598231a9003b62291d02238e12d` |
| X Layer acknowledgement of Arbitrum delivery | `0x31a8583a7a7ec6126a608d3c54dffbc09ea7a94bd6b764259a6ea6e04327fba9` |

Source token is `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3`. Merchant is `0xe72e260811c6fbc27d1c350d92abaac89bbf803d`. Destination native tokens and domains are pinned in [stablecoins.json](deployments/stablecoins.json). Each successful payment is exactly **100000 atomic units**.

## 5. Bugs found and disposition

| Finding | Effect | Disposition |
| --- | --- | --- |
| Studionet idle validator appended to leader receipts | A finalized APPROVE was misclassified as a VM error and safely cancelled | Fixed in `72e506e`: select the final labelled leader; preserve actual finality, calldata and consensus checks. Positive, negative and rotated-leader regression controls pass. [Original incident proof](deployments/genlayer-receipt-normalization.json) retains the cancellation; it was not rewritten as PAID. |
| Empty GitHub Actions RPC variable | An empty override bypassed official destination defaults and prevented reconciliation | Fixed in `2be72cf`: trim and fall back for missing/empty/whitespace values. Explicit overrides remain supported. Testnet-only validation controls pass. |
| Audit waited for one bridge before admitting other scenarios | External finality prevented remaining routes and rejection tests from being exercised | Fixed in `e2f3116` and `e4d9b59`: admit independent scenarios first, poll and checkpoint all cases, verify completed outcomes, and test idempotency immediately. |
| Structured proposal model output failed | First proposal finalized unsuccessfully with MAJORITY_DISAGREE | Not claimed fixed. The failed proposal remains recorded. Identical unactivated audit policy was submitted under a new ID only after proving no activation/deposit journals existed. |
| Standard transfer outlasted a polling window | Run 40259970051 ended AUDIT_WAIT_PENDING while Arbitrum was legitimately awaiting confirmations | Same durable requests resumed in run40260466255 and completed; no replacement burn occurred. Production reconciliation continued automatically. |
| Vercel deployment fetch errors | Several CLI publication attempts failed before build creation | Subsequent CLI retry succeeded at `dpl_8p8trZ7Au3NxstvjtN8hsmYhmRYj`; both aliases were explicitly aligned and hosted login verified. |

## 6. TapeOut, GenLayer and remaining limits

**TapeOut is a required execution dependency on X Layer testnet.** Independent onchain checks verified the actual agent vault processor, circuit ID, netlist hash and processor code hash. Calling the deployed preview accepted 100000 atomic units and blocked 1000001 under the per-payment limit. The same pinned numerical guard is required before reservation and release/burn.

The adapter runs TapeOut's unchanged NetlistVM with IntentGuard's circuit: 1,766 NAND gates, 451 inputs and 8 outputs. It is a labelled testnet adapter, not an official TapeOut CPU-registry deployment. Vercel hosts the frontend/API; X Layer DeWEB is not used.

GenLayer finalized both semantic approvals and the prohibited-purpose rejection. Optimistic Democracy and validator review reduce dependence on one model; they do not eliminate hallucinations or disagreement. The configured attestor remains trusted for release and foreign-chain receipt acknowledgement.

**USDT0 remains externally blocked.** The supplied issuer address has no bytecode on X Layer testnet1952 and belongs to mainnet196. An official testnet token/OFT deployment, test-token source and supported peers are required. No mock asset or mainnet substitution was made.

This audit does not retroactively change the [original 12-request audit](AUDIT-12-FINDINGS.md): that audit remains **10/12 matched outcomes** on the immutable legacy v1 reviewer. Its semantic-denial failures remain limitations. This new V3 audit proves the listed eight scenarios only; arbitrary-network routing, USDT0, mainnet and general prompt-injection reliability are not certified.
