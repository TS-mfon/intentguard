# IntentGuard build plan recovered from session 01a16b8e-b514-7482-83c3-7bdb9b2ade64

## Original accepted scope
Build a standalone agent spending-card application. Owners describe a mandate, review GenLayer-proposed terms, activate and fund a per-agent vault. Agents use per-card API keys for direct merchant payments. TapeOut executes exact numeric spending comparisons and reserves capacity. GenLayer independently reviews committed public merchant evidence. Only successful finalized approval permits an EIP712-attested release; the vault rechecks its limits and pays once.

Required interface: graphite ATM-style cards, agent identities, payment ledger, permission wizard, wallet controls and one-time keys. Include durable jobs, safe evidence fetching, SDK, OpenAPI, deployment tools and meaningful financial/semantic/replay tests.

## Recovered stopping point
The EVM/TapeOut, GenLayer and frontend agents returned complete deliverables. The API/worker leaf and all three delegated leaves were independently checked. Dispatch wave ready-1 completed. Root gates recorded all-tests, local integration and release validation; the production browser gate remained pending. The last implementation changed exact ledger selectors and added the real API-to-worker-to-vault integration callback. Repeated interrupted continuations did not finish those checks.

## Current user amendment (2026-10-24)
1. Create a new GitHub repository with gh and push the completed source.
2. Run the durable worker through GitHub Actions.
3. Deploy frontend and API using Vercel CLI.
4. Deploy contracts to testnets, with GenLayer Studionet, using the user-provided /home/sudodave/.env.build credentials. Never deploy this task to mainnet.
5. Verify the hosted end-to-end application and report concrete blockers, remaining work and findings.

## Acceptance
Current local build, types, contract/circuit/GenLayer/API tests and production browser checks pass. GitHub source and worker workflow exist. Public testnet contract deployments are verified. Hosted API uses durable shared storage, real testnet contracts and a working worker. An owner proposal and an agent payment complete through the hosted application. Unavailable external credentials or infrastructure remain explicit unmet outcomes.

## Product amendments and final validation
The owner selected charcoal surfaces, crisp IBM Plex type and restrained green. Implement a public landing with the latest four persisted requests; full documentation; authenticated policy/name/budget setup; an owner agent workspace; public agent/transaction explorers; and transaction details with independently verified finalized GenLayer reasoning. Remove the former preview data path and fix authentication across legitimate Vercel aliases.

Verification separates isolated browser fixtures from the real hosted system. Direct tests cover EVM, circuit arithmetic, GenLayer validation, API privacy/origins and durable worker recovery. Hosted acceptance exercises a paid purchase, a budget rejection, a semantic rejection, reservation release and an identical idempotency retry. Hosted browser checks use actual records and domain-bound owner-login signatures on both production aliases. GitHub Actions remains the only live worker.

## Subsequent identity, story and cross-chain amendments (26 October 2026)

Preserve the established main UI, show the latest three actual transactions, provide downloadable agent cards with measured usage, publish a bounded 22-section docs system and maintain synchronized SDK/OpenAPI/MCP/skill integrations. The separate /why-we-exist story has an interactive six-act 3D agent/card scene, progressive scroll, opt-in sound and a rendered protocol film. Both production aliases remain authenticated correctly.

The current funding direction is owner deposits on X Layer, then the agent spends on approved destination testnets. USDT was removed; USDC and USDT0 were requested. Native USDC is verified on X Layer1952, Base84532 and Arbitrum421614. USDT0 has no verified issuer testnet deployment and remains disabled pending an official token/OFT route and source of test funds.

Acceptance for this phase requires the guarded factory deployed through Actions, exact native-USDC funding receipts, immutable owner-selected destinations, mandatory TapeOut and finalized GenLayer checks before release, durable CCTP burn/attestation/mint/acknowledgement without false PAID or duplicate burns, Vercel frontend/API publication, and a live route/rejection/evidence/idempotency audit with independent receipt and accounting verification.

Completed evidence: factory deployed and its runtime verified; five native USDC bridged Base→X Layer through one resumed operation; one USDC deposited in the dedicated audit vault; runtime/UI/docs published; 244 automated tests and hosted wallet/card/docs/real-data checks passed. The native-USDC live audit passed all eight scenarios; independent source/deposit/GenLayer/receipt/accounting and hosted checks passed. A failed proposal was preserved and an identical unactivated replacement finalized successfully. Later leader-receipt parsing, empty destination-RPC fallback and audit scheduling bugs were fixed and validated. See BUILD-REPORT.md for current receipts, source revisions and blockers; the historic 12-request audit remains 10/12.
