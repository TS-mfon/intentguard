# GitHub Actions isolation and reproducibility

All third-party workflow actions use immutable reviewed commit SHAs. Runners, Node, pnpm, Foundry, Python, uv and GenLayer validation packages have explicit versions. Read-only validation jobs do not receive execution secrets. Privileged testnet jobs refuse branches outside `main`, an unexpected payment chain, or the mainnet database name.

The separate `worker-mainnet.yml` uses the `mainnet` environment, dedicated `MAINNET_*` secrets, and its own concurrency group. Before checking out code or loading signing keys, it requires the approved immutable source commit, exact manifest digest, mainnet chain196, isolated database, and Studionet review identity. Scheduled execution starts disabled and cannot use a repository testnet-secret fallback. Repeated worker execution must preserve unresolved burns and transaction journals.

The driver independently reran `node tools/production/verify-workflows.mjs` on 2026-10-26. It runs actionlint plus17 invalid mainnet-preflight cases and four mutation controls that deliberately insert a mutable action, a PR-secret leak, a testnet-secret fallback, and an incomplete dependency audit. This closes R07's source-level workflow finding. Live environment configuration and enabling funded mainnet execution remain release requirements.
