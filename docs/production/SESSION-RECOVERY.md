# Recovered build plan and stopping points

Recovered from sessions `01a16b8e-b514-7482-83c3-7bdb9b2ade64`, `01a16dfe-290c-7dc2-b9e5-7681f0e854f4`, `01a183a8-cf08-7702-bb27-5eb78530817d`, `01a187a7-aab3-7573-a19c-765bf9cb44b8`, and the latest session `01a18931-0d09-7af0-b37e-019af635e753` on 2026-10-29. The original implementation plan is [BUILD-PLAN.md](../BUILD-PLAN.md); the authoritative amended acceptance contract is [REMEDIATION-PLAN.md](REMEDIATION-PLAN.md), covering R01–R27. Original reviews and their hashes remain preserved in the findings register.

## Accepted product and release contract

IntentGuard issues an owner-funded spending vault and a card-scoped agent API key. GenLayer proposes readable permissions from the owner’s mission and criteria. TapeOut’s mandatory numerical circuit checks spending at reservation and settlement; successful finalized GenLayer evidence review is also required before payment. The owner retains funding, withdrawal, pause, cancellation, revocation and key rotation. Public records and reasoning come from actual operations; fixtures remain confined to isolated verification.

Preserve X Layer testnet 1952 and its database. Prepare a separate X Layer mainnet 196 release with local USDT0 and native-USDC CCTP routes to Base, Arbitrum, Optimism, Ethereum, Polygon, Avalanche, Unichain, Linea, World Chain and HyperEVM. Owners select an immutable destination subset. Both payment environments explicitly disclose GenLayer Studionet 61999 testnet review. Publish the static frontend through TapeOut/DeWEB with a separate API and GitHub Actions worker. Paid provisioning and mainnet broadcasts require a concrete current quote and an explicit spending cap.

## Where the sessions and agents stopped

| Session | Last useful state | Stop condition |
|---|---|---|
| 01a16b8e… | Initial product plan and contracts, API/worker and UI implementation | Later continuation turns repeatedly failed at the host and were interrupted |
| 01a16dfe… | R01–R27 production tree; foundations, V4 contracts, reviewer, runtime/security, issuer, hosting and database preparation; authenticated frontend/API commit `5a24218` | Frontend agents `/root/production_frontend` and `/root/production_frontend_finish` returned host errors; driver stopped recovering leaf 3.1 |
| 01a183a8… | Static frontend/browser preparation and substantial SDK/MCP/OpenAPI/release-tooling edits remained uncommitted | `/root/recovery_frontend` failed; product/release retries stopped with provider errors; the root also failed before integration/commit/deployment |
| 01a187a7… | Product/tooling preparation verified; invitation drafts saved; staged deployment tooling and film source prepared; public configuration repaired and deployment-quote wallet selected | Film and mainnet agents returned provider failures; root was repeatedly interrupted before source integration, current CI, testnet publication, final release reports or film export |
| 01a18931… | Packaging passed; production frontend reports existed; film renderer gained font and receipt checks; staged mainnet tooling passed its initial regressions | Root stopped after the full regression command hit a read-only Python cache, identity verification was interrupted and story verification timed out; film child `01a18948…` failed before final capture/export |

The latest child reports were independently recovered: product `01a187b4…` completed implementation and later saved three prospect invitations; release `01a187b7…` completed its source/compiler review while leaving source-bound report generation to the driver; film `01a18816…` stopped after verifying actual public receipts and immutable terms; mainnet `01a18817…` ended with a provider error. Scheduler returns do not grant completion credit. Their stale ownership leases were recovered only after confirming the recorded PIDs were absent.

The latest user selected `0xEd9EDd8586b20524CafA4F568413C504C9B03172` as the mainnet quote sender. This selection remains valid; it does not establish funding or authorize a spending cap. The user also requested saved Markdown contacts and invitations and explicitly held delivery until the build is ready and they have tested three agents and five requests. [PILOT-OUTREACH.md](PILOT-OUTREACH.md) preserves those drafts and the test checklist. Actual customer demand remains unmeasured.

At this recovery, the original ledger reported 17 met and 43 unmet gates, including branch and external release requirements. Old lease PIDs 7046, 7060 and 7074 were absent. The recorded retries were settled as scheduler returns without granting completion credit, and exact leases were recovered. The existing testnet Vercel deployment was still the 2026-10-26 application; commit `5a24218` had failed GitHub’s wallet browser check.

The fifth-session recovery confirmed that lease PIDs 50411, 50418, 50425 and 50432 were absent and settled the interrupted film/mainnet wave without granting completion credit. Its unpushed API correlation fix was commit `35a76d3`. A fresh standalone build passed identity and story browser verification, including actual WebGL/context-loss recovery, media playback, separate film/scroll controls and short mobile viewports. Running the regression suite with access to the existing Python cache passed 133 EVM, 206 direct GenLayer, 186 API/worker and 6 circuit tests; TypeScript passed. These are local implementation checks, with no new payment admissions.

## Work recovered and verified

- Static export for testnet and mainnet with explicit origins, source/chunk hashes, query transaction links and legacy TapeKit fallback. Both profiles exercise the production cross-origin wallet login, memory-only owner tokens, replacement acknowledgement, exact token funding calldata, proof downloads, real-record UI states, card downloads, docs, media and reduced motion in isolated HTTPS browsers. Standalone Next.js remains supported.
- Production API errors now preserve one request ID in their body and header. The browser fixture uses the actual normalized localhost origin and an isolated server environment; it passes without weakening the production origin guard.
- Protocol version 0.4 SDK, MCP, OpenAPI and skill synchronize settlement V2, reviewer V4, payment/review identity, public/authenticated requests, bridge proof, retries and errors. SDK type checks and a copied standalone runtime are verified.
- Commercial materials independently measure archived testnet latency and clearly label pricing assumptions. The demo script references actual recorded operation IDs. Customer validation and a submission film require actual evidence.
- Release preparation binds current source, lock/toolchain, ABI, compiler artifacts, circuit/vendor/reviewer/runtime inputs and real read-only protocol observations. It rejects stale, duplicate, missing or mismatched inputs. Generated reports are ignored because they bind the current source commit; regenerate after every source change.
- Staged deployment tooling now verifies Studionet genesis before current-state reads, normalizes the actual ERC6551 processor tuple, and resolves a newly created CPU's unique registry index at its receipt block if a concurrent deployment changes the append index. The independent tooling verifier exercises 78 regressions. This does not certify a mainnet deployment or authorize spending.
- The submission renderer runs in the pinned motion project, binds root and motion dependencies plus local fonts, measures narration against scene duration, and refuses changed source before rendering. Live capture and exported-artifact verification remain required after publication.

The executable checks are `node tools/production/verify-frontend.mjs`, `node tools/production/verify-product.mjs`, and `node tools/production/verify-release-preparation.mjs`, plus API/worker, circuit, EVM, direct GenLayer, browser, workflow and packaging checks. Their reports distinguish local fixtures from live receipts. CI preserves browser evidence.

## Remaining release sequence

1. Commit and push integrated source, pass GitHub validation, update the existing testnet Vercel application and verify its actual hosted routes, public records and review disclosure.
2. At clean current source, regenerate the release preparation and current mainnet quote. Keep known protocol fees, gas estimates and unresolved dependent costs separate. A quote is preparation evidence and does not authorize spending.
3. Review a current stage-specific quote and obtain the required spending cap. Deploy and independently verify official TapeOut CPU/circuit, mainnet factories/reviewers and DeWEB container/site; bind database/API/worker identity before enabling execution.
4. Run limited authorized canaries on all ten destinations, owner recovery/control checks, full bridge receipts and two fresh semantic/reliability audits. Verify availability from three independent environments.
5. Conduct actual customer interviews and recurring pilots with explicit outreach/funding authorization, record the submission film against verified hosted behavior, and reconcile every original finding and root acceptance gate.

Preparation and an updated testnet application do not certify mainnet deployment, live mainnet CCTP delivery, customer demand, or the complete R01–R27 release. Required external and spending-dependent gates remain visible.
