# IntentGuard verified testnet build

The application is live at [intentguard-gen-daves-projects.vercel.app](https://intentguard-gen-daves-projects.vercel.app). Frontend and API were deployed with Vercel CLI; the durable worker runs through GitHub Actions. Contracts use X Layer testnet **1952** and GenLayer Studionet **61999**.

Source: [TS-mfon/intentguard](https://github.com/TS-mfon/intentguard), application commit `77ed7c40ff4f3ad89467c34682d252a75cc9d8ef`.
Vercel release: `dpl_47GuKrN7igvStyp5CGUcgA64Ufoi`, [deployment](https://intentguard-379davy8k-gen-daves-projects.vercel.app).
Final published-source [worker run](https://github.com/TS-mfon/intentguard/actions/runs/40156313276) completed successfully.

## Recovered plan and stopping point

[BUILD-PLAN.md](BUILD-PLAN.md) records the plan extracted from session `01a16b8e-b514-7482-83c3-7bdb9b2ade64`. The previous build had returned contracts, circuit and API work; its final production browser verification remained unfinished. This continuation completed those checks, deployed the infrastructure, verified real hosted payments and implemented the later product amendments.

Both active agents returned their deliverables. Root independently re-executed the hosted acceptance and frontend browser gates, reviewed the screenshots and released their exact ownership leases.

## Delivered interface

| Page | Working behavior |
|---|---|
| [Landing](https://intentguard-gen-daves-projects.vercel.app) | Dark charcoal/green design; latest four persisted payment requests with actual states |
| [Agent setup](https://intentguard-gen-daves-projects.vercel.app/agent-setup) | Wallet authentication; name, mission, context, categories, exclusions, exceptions, merchants, evidence, criteria, budgets and UTC validity; full finalized terms before activation |
| [My agents](https://intentguard-gen-daves-projects.vercel.app/agents) | Owner-scoped agents, balances, immutable policies, transactions, funding/faucet, pause/revoke/withdraw/cancel controls and one-time keys |
| [Explorer](https://intentguard-gen-daves-projects.vercel.app/explorer) | Public agents and transaction records, pagination, filters and search within loaded records |
| [Documentation](https://intentguard-gen-daves-projects.vercel.app/docs) | 19 sections covering setup, policy fields, funding, keys, SDK/API, invoice format, evidence commitments, reasoning, contracts, trust, worker operation and troubleshooting |
| [Paid transaction](https://intentguard-gen-daves-projects.vercel.app/explorer/transactions/0x3c47642a512e1a99b66c0e5351342538219908aa2f49145e342bc4ab93f646b0) | Exact recorded payment, budget reservation, policy/evidence commitments, finalized GenLayer reasoning, criterion outcome and source links |

The former dashboard preview data path was removed. The public feed contains issued requests and actual testnet outcomes. One genuine earlier failed evidence attempt remains in the ledger for traceability; it reserved and paid nothing.

Wallet login works on both the stable address and [intentguard-ivory.vercel.app](https://intentguard-ivory.vercel.app). Challenge messages bind to the requested alias. Missing/null/unrelated origins and cross-site mutations remain denied. Account changes and signing races clear the owner session and visible one-time credentials.

## Real end-to-end evidence

Owner vault: `0xDb5EAF29025Cb8a94536649997f830dE87F78cdC`. The owner activated it, minted ten TEST-USDT and funded it with ten tokens through confirmed testnet transactions.

| Case | Observed result |
|---|---|
| Research purchase, 1 TEST-USDT | PAID; successful finalized GenLayer approval; exact matching Paid event and merchant balance increase of 1 |
| Research purchase, 6 TEST-USDT | BLOCKED by the per-payment limit before reservation or GenLayer review |
| Personal entertainment, 1 TEST-USDT | REJECTED by the finalized GenLayer contract; reservation cancelled |
| Identical idempotency retry | Original request ID returned; no duplicate payout |
| Final accounting | Spent 1; reserved 0; available 9 TEST-USDT |

[Payment receipt](https://www.oklink.com/xlayer-test/tx/0x47d329787c0fe71160858db0cbb5b13f4fe1ecf59ffaa163b9e1366bc90c406b)
· [Approved GenLayer review](https://explorer-studio.genlayer.com/transactions/0x0240c3ac0f79217ec431e5a94ea5140148179c731ea33a39b7a9fac3e7d92186)
· [Rejected GenLayer review](https://explorer-studio.genlayer.com/transactions/0x7ed610a437da5e26624c39bdd2b926470677ba9d707021174c2e37176fbdbd66)

The verification independently decoded finalized GenLayer calldata, matched the original request and invoice bytes, checked their hashes and the reviewer’s source/operator/policy/network, then compared the API reasoning with the actual contract result. The public UI showed those same reasons and criteria. Pending or unverifiable reasoning is withheld.

Public machine-readable evidence: [acceptance.json](deployments/acceptance.json), [hosted-browser.json](deployments/hosted-browser.json), [testnet.json](deployments/testnet.json). Private credentials, cookies, signed transaction bytes and resumable journals remain under ignored mode-0600 local files and configured hosting secrets.

## Validation

- **149 automated tests passed:** 40 EVM, 6 circuit, 58 GenLayer and 45 API/core/worker tests. Circuit tests included 6,000 independent comparison vectors.
- TypeScript checks, production build, OpenAPI/SDK and release artifact checks passed.
- Production browser checks covered 19 flows at widths 390, 768, 1440 and 1920, including empty/error states, draft recovery, declined wallet actions, API errors, account-switch races, keys, public explorers and safe citations.
- Real hosted browser/API checks passed on both aliases, with actual domain-bound owner login signatures, durable records, complete docs and verified contract reasoning. Latest check: `2026-10-25T02:51:57.211Z`; zero page errors.
- The staged source passed a comparison against private build credentials. Vercel upload rules exclude private environments/journals and local caches.
- Delivery ledger: **16 met, 0 unmet, 0 abandoned** across root and four leaves; all three dispatch waves completed.

## Findings and operating limits

The resolved live evidence-fetch failure came from Node 24’s dual-stack DNS callback contract. The pinned lookup now returns an address array when requested and retains its single prevalidated address. Regression tests cover both callback forms. The replacement purchase used a fresh invoice and idempotency key after proving the earlier attempt had no reservation or payout.

Vercel’s current Next.js adapter needed the webpack server trace, so hosting uses `next build --webpack`. Browser-origin handling was corrected for production aliases. Studionet transaction normalization now checks its actual simulator response shape, successful finality and exact constructor integers.

MongoDB Atlas M0 supplies shared durable storage. The dedicated application database user is scoped to this database and cluster. MongoDB skills/MCP setup and authenticated database checks completed.

GitHub Actions processes bounded scheduled bursts every five minutes; scheduling and GenLayer consensus affect completion latency. This is a testnet application using faucet TEST-USDT, which has no monetary value. The testnet adapter executes TapeOut’s unchanged NetlistVM; it is a labelled adapter rather than an official TapeOut testnet CPU registry deployment. X Layer verifies the configured attestor’s signature for foreign-chain approval, so that attestor remains part of the trust model.

## Blockers and remaining work

**No open build blockers or remaining required implementation items for the requested testnet scope.** All requested pages, API flows, deployment steps and payment acceptance checks are implemented and verified. Owner policies remain immutable; changing a policy requires a replacement vault. Normal operation requires the configured testnets, merchant evidence, Atlas service and scheduled Actions worker to remain available.
