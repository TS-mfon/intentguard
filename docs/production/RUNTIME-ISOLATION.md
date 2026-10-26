# Runtime isolation implementation

Payments require an explicit local, testnet or mainnet profile. Missing configuration renders an unconfigured local application. Mainnet payments use X Layer196; semantic review uses GenLayer Studionet61999 and remains labelled testnet in configuration, card records and public payment proofs.

Mainnet requires `intentguard_mainnet`, a canonical HTTPS origin, separate gateway/attestor keys, source commit, release identity and a hash-pinned verification manifest. API admission rejects a missing, changed or mismatched manifest. Public asset/destination capabilities come only from that manifest; candidate issuer routes never become available automatically.

Owner sessions and new agent credentials bind the payment environment and chain. Copying a session or key record into the other environment fails even if an operator copied the session secret. Legacy unscoped keys remain accepted outside mainnet for compatibility.

Cards bind their payment environment, source chain, actual token, V4 settlement permissions and Studionet review identity. New V4 reviewers receive the explicit mainnet/testnet payment profile while executing on Studionet. Deployment verification checks source, constructor, policy, operator, token, settlement and profile hash. The worker persists V4 after deploying V4; it does not downgrade its readiness check to V3.

Signed EVM journals bind environment, chain and gateway. Recovery verifies serialized chain, destination, calldata, zero native-token value and recovered signer before broadcast. GenLayer journals bind payment and review environments. The mainnet wake coordinator uses `worker-mainnet.yml` and supplies the approved release commit; it cannot fall back to the testnet worker.

Studionet RPC inspection returned chain61999, a zero genesis hash and no EVM code at the SDK consensus address. Genesis/address pins detect configuration mismatches, not simulator resets or proof of an EVM consensus deployment. Exact finalized transactions, deployed reviewer source and policy/request/evidence commitments still require verification. No GenLayer mainnet claim is made.

The MongoDB cache includes URI, database, environment, release and signing identity. Mainnet requires dedicated API/worker principals, a separately initialized environment marker and required indexes. Bootstrap refuses populated unlabelled databases or mismatched markers. It creates metadata/indexes without financial/demo records.

The existing workload uses Vercel instances and bounded Actions jobs. Each reused pool holds at most5 application sockets per server, min0, idle30s. Server selection/connect are bounded at10s, pool waiting5s, total operation15s, below the120s worker lease. These conservative serverless settings are not a measured throughput claim. Monitor Atlas connections, operation latency, pool checkout failures and worker storage errors before resizing.

`GET /api/v1/health` reports release/source identity, both networks, database reachability and worker freshness without credentials. A stale worker produces503 rather than a healthy status.

## Verification and remaining acceptance

The driver reverified88 runtime integration tests with zero failures/skips and six database tests. The complete application suite passed127 tests, and TypeScript validation passed. Positive controls and attacks cover copied credentials, wrong card/route/token/reviewer bindings, journal tampering, changed manifests, missing indexes, unsafe database initialization, financial blocks, semantic failures, irreversible-burn recovery and duplicate execution.

A timing defect found during integration is repaired: invoice freshness is evaluated after evidence capture, so an invoice issued while capture is running is not incorrectly considered future-dated.

Fixtures and local tests do not prove Atlas authorization, backup restoration, hosted availability or live GenLayer consensus. R08 remains partial until SDK/frontend and deployed acceptance agree. R09 remains open for actual provisioning, denied testnet access and backup restoration. The original failed audits remain unchanged; no mainnet payment, database provisioning or paid service is claimed here.
