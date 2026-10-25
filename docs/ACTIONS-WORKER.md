# GitHub Actions worker

New policy drafts, activated agents, payments and revocations automatically wake GitHub Actions after their durable MongoDB records are committed. Authenticated reads of pending drafts, cards and payments retry the wake, so reopening an interrupted setup can recover it. Vercel uses Next.js `after()` to perform the trigger after sending the API response.

Each Actions run processes the shared queue for 180 seconds. A finishing run checks for remaining work and requests a continuation. The five-minute schedule and manual `workflow_dispatch` are fallback recovery paths. GitHub runner availability and GenLayer consensus can still introduce minute-scale latency.

## Concurrency and recovery

A short durable `worker-wake` lease coalesces API bursts and applies a 15-second success cooldown. The helper inspects queued Actions runs and the active runner's heartbeat/deadline. It reuses a healthy runner and dispatches a continuation for a stale or nearly finished runner. The finishing runner clears the admission cooldown before handing off work.

Workflow concurrency serializes runs without cancelling the active run. MongoDB's global worker lease remains authoritative for signing nonces. Requests, immutable evidence commitments and signed transaction journals remain in MongoDB.

GitHub failures preserve admitted work. Trigger errors are logged without upstream bodies or credentials, and a short retry cooldown permits recovery. The API still returns its successful admission. Empty queues never trigger a run.

The runner stops new claims at its deadline or SIGTERM/SIGINT and completes its current tick. Three consecutive connectivity/storage failures fail the run visibly. The eight-minute workflow limit recovers through lease expiry after a stuck network operation.

## Configuration

Repository secrets: `MONGODB_URI`, `XLAYER_OPERATOR_PRIVATE_KEY`, `REVIEW_ATTESTOR_PRIVATE_KEY`, `GENLAYER_OPERATOR_PRIVATE_KEY`.

Repository variables: `INTENTGUARD_MODE`, `XLAYER_CHAIN_ID`, `XLAYER_RPC_URL`, `PAYMENT_TOKEN`, `CARD_FACTORY_ADDRESS`, `GATEWAY_ADDRESS`, `ATTESTOR_ADDRESS`, `TAPEOUT_PROCESSOR`, `TAPEOUT_CIRCUIT_ID`, `TAPEOUT_BEACON`, `TAPEOUT_IMPLEMENTATION`, `TAPEOUT_NETLIST_HASH`, `GENLAYER_INTERPRETER_ADDRESS`, `GENLAYER_RPC_URL`, `MONGODB_DB`, `APP_URL`.

Vercel server-only settings:

- `GITHUB_WORKER_TOKEN`: token with repository Actions read/write. Use a repository-scoped fine-grained token for a dedicated installation.
- `GITHUB_WORKER_REPOSITORY`: repository owner/name.
- `GITHUB_WORKER_WORKFLOW=worker.yml`.
- `GITHUB_WORKER_REF=main`.

The Actions workflow has `contents: read` and `actions: write`, and uses its ephemeral `github.token` for continuation dispatch. Vercel holds no blockchain signing keys. The authenticated hosting helper `pnpm exec tsx scripts/configure-hosts.ts worker-wake` configures the server-only settings without printing the token.

Use the same database and testnet configuration for API and worker. Signing accounts must be exclusive to this installation. Atlas network access must permit the hosting providers' dynamic egress.

Locked dependencies use Node 24 and pnpm 11.9.0. The workflow refuses signing unless mode is `testnet` and X Layer chain is `1952`. GenLayer uses Studionet.

## Verification

`pnpm exec tsx scripts/check-worker-wake.ts` checks concurrency, active-run reuse, handoff, failures, credential isolation and API recovery. `pnpm exec tsx scripts/verify-worker-trigger.ts` submits a real hosted policy proposal and independently checks the automatically started Actions run and successful committed GenLayer finality. It does not submit payments or activate another vault.
