# IntentGuard testnet build report

Status checked on 26 October 2026. The application is live at [intentguard-tapeout.vercel.app](https://intentguard-tapeout.vercel.app), with the former [intentguard-gen-daves-projects.vercel.app](https://intentguard-gen-daves-projects.vercel.app) alias preserved for existing immutable merchant-origin permissions.

**The native-USDC testnet application is published and verified end to end: 8/8 live audit scenarios passed, including all three delivery networks. USDT0 remains unavailable on X Layer testnet; the complete two-asset request therefore retains an issuer-deployment handoff.**

## Source, hosting and worker

| Component | Evidence |
| --- | --- |
| Repository | [TS-mfon/intentguard](https://github.com/TS-mfon/intentguard) |
| Runtime source | `e4d9b596d4a8c4b6ffe9e6afa5f91c6d699ca21c`; latest application-code fixes are the GenLayer leader-receipt correction and destination-RPC fallback |
| Audit source | `e4d9b596d4a8c4b6ffe9e6afa5f91c6d699ca21c` |
| Vercel CLI release | `dpl_8p8trZ7Au3NxstvjtN8hsmYhmRYj`, [deployment](https://intentguard-nymtx6jhp-gen-daves-projects.vercel.app) |
| Hosted verification | `2026-10-26T03:08:11.940Z`: both aliases, one wallet signature per login, actual usage, API errors and 22 docs routes; zero page errors |
| Full validation | [Run 40260449690](https://github.com/TS-mfon/intentguard/actions/runs/40260449690), code commit `e4d9b59`, passed |
| Live transaction execution | GitHub Actions only, with durable MongoDB journals and a shared signing lease |

Networks are X Layer testnet **1952**, GenLayer Studionet **61999**, Base Sepolia **84532** and Arbitrum Sepolia **421614**. No mainnet execution occurred.

## Recovered plan and current scope

[BUILD-PLAN.md](BUILD-PLAN.md) preserves the plan recovered from session `01a16b8e-b514-7482-83c3-7bdb9b2ade64`. The original hosted payments, owner setup, explorer, docs and wallet fixes were completed before the subsequent identity, story and cross-chain amendments.

The latest requested flow is **human deposits native USDC into an X Layer agent vault → agent pays an approved merchant on X Layer, Base Sepolia or Arbitrum Sepolia**. The owner selects immutable destinations during setup. This is a restricted native-USDC CCTP V2 integration, not an arbitrary-network or arbitrary-asset bridge.

USDT was removed from the current scope by the user. Existing TEST-USDT agents remain usable and accurately labelled as legacy synthetic test assets; their balances and immutable reviewers are not silently converted.

## Delivered product

| Surface | Current behavior |
| --- | --- |
| Landing | Existing charcoal ATM-card design, actual usage and the latest three persisted transaction records |
| Agent setup | Wallet authentication; agent identity, mission, task context, categories, prohibitions, exceptions, merchants, evidence criteria, total/per-payment/period limits, UTC validity, native USDC and approved destinations |
| My agents | Owner-scoped vaults, policy, balances, funding with the card’s actual token, reviewer initialization, one-time API keys and available owner controls |
| Agent cards | Downloadable SVG and 1200×760 PNG with measured request counts, confirmed funds moved and a public X share link |
| Explorer | Public agents and real payment records; paginated navigation, status filtering, exact transaction commitments, finalized GenLayer criteria/reasons and source/destination receipts |
| Docs | 22 bounded section routes, full protocol manual, OpenAPI 0.3, SDK, MCP resources and an installable agent skill |
| Why we exist | Continuous Three.js agent/ATM-card story, six scroll-driven chapters, pointer motion, permitted/blocked branches, opt-in audio and a rendered 28-second protocol film with sound controls and transcript |
| Errors and states | Structured HTTP errors with stable codes, retry flags and correlation IDs; numeric/evidence rejection skips review; irreversible burns stay in reconciliation until exact delivery is verified |

Public balances, cards and the latest feed come from actual stored requests and chain outcomes. The protocol-verification merchant issues real testnet invoices for the live audit; there are no seeded sample transactions or invented balances.

## Verified native-USDC infrastructure and funding

[CCTP deployment proof](deployments/cctp.json) and [independent RPC check](deployments/cctp-funding-independent.json) record the live evidence.

| Operation | Observed result |
| --- | --- |
| Guarded USDC factory | `0x12f4e3c0c3cb53854bd8f60ccfea3bce96f60ba6`, deployed through [Actions run 40254429179](https://github.com/TS-mfon/intentguard/actions/runs/40254429179) |
| Factory integrity | Compiled runtime hash `0x556a67d6594c335ec8ac3e75ad014bd7b3be68bc0b85b15237a88461761daf27` matches deployed code |
| Funding burn | Five native USDC burned on Base Sepolia: [receipt](https://sepolia.basescan.org/tx/0x29186b5899e6b7bf466ea5704866179e7107829e589d313e377d0637eff1c443) |
| Funding mint | Exactly five native USDC minted to the fixed operator on X Layer: [receipt](https://www.okx.com/web3/explorer/xlayer-test/tx/0x9b6a307a47d693b644e5fffd645cb1d345d610dd8be63d2445dbe3e5974f2a8e) |
| Recovery | Initial worker ended `ATTESTATION_PENDING`; [run 40256261814](https://github.com/TS-mfon/intentguard/actions/runs/40256261814) resumed the same source burn and completed the mint |
| Independent verification | Root verified both chain IDs, successful receipts, exact native-token burn/mint events, CCTP nonce/domain/finality, single nonce consumption, factory hash and destination confirmations at `2026-10-26T01:58:20.520Z` |

Native issuer token addresses and all six directed CCTP mappings are independently recorded in [stablecoin research](STABLECOIN-RESEARCH.md) and [stablecoins.json](deployments/stablecoins.json).

## Expanded live funds audit

The [successful resumed audit](https://github.com/TS-mfon/intentguard/actions/runs/40260466255) uses one dedicated vault, `0xB914C71A5667E816f248F6aaB41546200f2d43B1`, with a verified V3 reviewer. One native USDC was deposited through [this confirmed transaction](https://www.okx.com/web3/explorer/xlayer-test/tx/0xcdfb4b20bf59809c7fa42150a302d2a0c07cda862a187beb573ce8c3b91373b4).

The runner verified **8/8 scenarios**: exact 0.1-USDC payments on each of the three allowed testnets, mainnet-destination rejection, a numeric limit block with skipped review, prohibited-purpose rejection, wrong-buyer evidence rejection before reservation, and an idempotent retry. Independent source deposit, source burn, destination mint, nonce consumption, GenLayer decision and vault-acknowledgement checks passed at `2026-10-26T03:08:34.246Z`. Final accounting is **0.3 USDC spent, 0.7 available and zero reserved**, with merchant balances of 100000 atomic USDC on each destination. Source burn, Circle attestation, destination mint and vault acknowledgement are separate durable phases. **Pending bridge initiation is never reported as PAID.**

The first audit proposal finalized unsuccessfully with `MAJORITY_DISAGREE` and `Invalid draft result fields`. Its failed draft and transaction remain retained. A bounded recovery submitted the identical policy under a new draft ID only after verifying no activation/deposit journals existed; the replacement finalized and activated successfully. This recovery is not a fix for model-output reliability.

[Detailed findings](AUDIT-CCTP-FINDINGS.md), [complete masked API logs](audits/cctp-live-results.json), [independent proof](audits/cctp-independent.json) and [hosted USDC verification](audits/cctp-hosted.json) preserve the evidence. The USDC card now shows seven actual admitted records, three confirmed payments and 0.3 USDC moved; the retained failed attempt is counted honestly. Mainnet denial and idempotent replay do not create additional records.

The original [12-request audit](AUDIT-12-FINDINGS.md) remains **10/12 matched outcomes**. Its two semantic-denial failures safely cancelled without payout on Dave’s immutable v1 reviewer. The [follow-up](AUDIT-12-FOLLOWUP.md) and newer-reviewer proofs do not retroactively turn those failures into successful finalized rejections.

## Automated and hosted validation

- **244 automated tests passed:** 98 API/core/worker, 68 EVM, 72 GenLayer and 6 circuit tests.
- TypeScript, production build, dependency advisories, contract/circuit release checks, OpenAPI/docs synchronization and wallet browser regressions passed.
- Actual WebGL/media verification passed 13 browser outcomes, including rendered scene movement, six poses, native scroll/keyboard response, opt-in audio, film playback, reduced motion, media/graphics fallback, context recovery and resource disposal. No page errors occurred.
- Hosted checks verified single-click wallet login on both aliases, owner isolation, actual usage/card exports/feed and structured 400/401/403/404/405/415/422 errors.
- Browser checks use Chromium with software WebGL and emulated widths 320, 390, 768, 1440 and 1920; they do not certify every physical mobile device/GPU.
- Test fixtures are isolated from the hosted application. Private credentials, cookies and signed raw transaction journals are excluded from public artifacts, git and Vercel uploads.

## TapeOut usage and trust

**Yes, IntentGuard uses TapeOut circuitry and contracts on X Layer testnet.** The generated circuit has **1,766 NAND gates, 451 inputs and 8 outputs**. Its pinned processor is `0xa34d101011d4dbe18375ff2e7591b646e22c2ff3`. The vault requires its exact numerical permission checks before reservation and again before direct settlement or CCTP burn; a failed circuit check cannot release funds.

The processor is a labelled testnet adapter executing TapeOut’s **unchanged NetlistVM**. [Vendor provenance](../contracts/evm/src/vendor/README.md) and [deployment pins](deployments/testnet.json) disclose this distinction. It is not an official TapeOut CPU-registry deployment. Frontend/API hosting is Vercel, not X Layer DeWEB.

GenLayer’s Optimistic Democracy and independent validators reduce dependence on a single model; they do not make hallucination or disagreement impossible. The source vault trusts the configured attestor for finalized GenLayer approval and verified foreign-chain CCTP receipt acknowledgement. This attestor remains a trust boundary.

## Findings, blockers and remaining work

1. **USDT0 testnet deployment is unavailable.** The supplied `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` has no bytecode on chain 1952; issuer docs identify X Layer mainnet chain 196 and the chain-1952 API returned no deployment entry. Enabling USDT0 requires an official testnet token/OFT deployment, faucet/source and verified peers. It remains disabled; no mock substitutes for the issuer.
2. **The USDC route audit is complete.** All eight scenarios passed and the final hosted USDC card, transaction reasoning, receipt links, PNG download and real landing-feed checks passed without page errors. No CCTP payment remains pending in this audit. This does not certify arbitrary networks or asset types.
3. **Legacy semantic denial and model-output reliability remain limitations.** Existing funded v1 reviewers are immutable. The new live proposal failure demonstrates that complete structured input can still encounter a failing model output.
4. **External availability controls latency.** Actions scheduling, GenLayer consensus, RPCs, public merchant evidence and Circle finality may delay completion. Durable reconciliation prevents false payouts and duplicate burns, but cannot guarantee instant service.
5. **Scope remains testnet-only and route-limited.** These issuer test tokens have no monetary value. “Any network” support, USDT0 routes and mainnet certification have not been implemented or claimed.

## Fixes made during live validation

- Fixed finalized GenLayer leader-receipt selection: an idle validator appended to `leader_receipt` can no longer turn the final leader's successful result into a false VM error. Actual error, disagreement, non-finality and calldata mismatch controls still reject. The earlier cancelled request remains cancelled and recorded in [the independent incident proof](deployments/genlayer-receipt-normalization.json).
- Fixed missing/empty/whitespace Actions destination-RPC overrides so verified public testnet defaults apply. Explicit configured overrides remain supported.
- Fixed the audit's bridge wait preventing other coverage. It now admits independent scenarios, checkpoints and verifies their results, and tests idempotency before awaiting all routes.
- Circle standard finality outlasted one audit window. The same burn resumed automatically in the worker and passed in the next audit run; no duplicate burn occurred. Several Vercel CLI fetch failures were transient; the final release succeeded and both aliases were verified.

Canonical phase acceptance is `root:G1`–`root:G7`: **6 met, 0 unmet, 1 abandoned handoff (`root:G7`, official USDT0 testnet availability)**. Leaf agents returned; their saved dispatch waves are settled. Remaining legacy v1 reviewer and attestor trust limits above remain explicit and are not retroactively certified by this audit.
