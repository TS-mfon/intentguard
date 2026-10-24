# Deployment

Build artifacts are reviewable before any public broadcast.

```sh
forge build --root contracts/evm
pnpm exec tsx scripts/deploy.ts check
```

The check reads X Layer chain identity, live TapeOut fees, the current circuit beacon/implementation and USDT decimals. It validates generated circuit metadata and prints a deployment plan without signing.

Use fresh dedicated funded deployer, gateway, attestor and GenLayer operator accounts. Inject secrets through the deployment platform; do not place them in client bundles. The gateway needs X Layer gas, and the GenLayer operator needs network transaction capacity. The attestor only signs EIP712 authorizations.

The CLI's explicit `--broadcast` flag enables a requested deployment step:

```sh
pnpm exec tsx scripts/deploy.ts tapeout --broadcast
pnpm exec tsx scripts/deploy.ts factory --broadcast
pnpm exec tsx scripts/deploy.ts genlayer --broadcast
```

The TapeOut step creates a CPU if none is configured, mints the NAND inventory required for the generated netlist, tapes out the circuit using the live exact fee, verifies its hash and metadata, and writes public addresses to `.local/deployment.json`. Reruns use that record. The factory step deploys CardFactory. The GenLayer step deploys the interpreter with the configured GenLayer operator and waits for successful finalized execution. No card is funded by the deployment CLI.

Copy the resulting public configuration into the web and worker environments. Do not assume the sample implementation or fees remain current. The processor, circuit, beacon implementation, bytecode and netlist are pinned by each card.

Web: deploy `apps/web` on Vercel with monorepo root install and the web build command, or use the supplied Docker image with command `pnpm --filter @intentguard/web start`. Set APP_URL to the exact HTTPS app origin and MONGODB_URI/session secret/public contract fields.

Worker: deploy the same source to a persistent service using `pnpm worker`, MongoDB and all three dedicated worker secrets. The Docker image defaults to the worker. Multiple worker replicas share MongoDB and a global signing lease. Keep these accounts exclusive to this installation to avoid outside nonce changes.

Demo merchant: `pnpm exec tsx scripts/merchant.ts` starts a separate invoice service on port 3301. Publish it through HTTPS and configure its origin plus recipient in the owner policy. Invoice content is persisted under `.local/merchant-invoices` so independent refetches obtain identical bytes. Creation requires DEMO_MERCHANT_ADMIN_KEY; read access is public.

Operational trust: GenLayer consensus is represented on X Layer by the EIP712 attestor. TapeOut contracts are upgradeable; pinned implementation changes stop spending and require a new reviewed card. Owner recovery of unreserved USDT remains available. No keys from unrelated local projects are used.

When using a local environment file, load it explicitly, for example `node --env-file=.env --import tsx scripts/deploy.ts check`. The public deployment record is resumable; the file also contains signed transaction bytes and must be protected as server state. Browser tests and local integration receipts are test evidence, not public-chain deployments.
