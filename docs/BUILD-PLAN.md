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
