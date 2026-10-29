# Web and worker packaging verification

The default Docker target serves the actual Next.js application. `--target worker` creates the separate queue executor. Both run as the unprivileged `node` user and share Node 24.18.0 pinned by image digest and pnpm 11.9.0 with the frozen lockfile. Credentials are provided at runtime and excluded from the build context.

Run `node tools/production/verify-packaging.mjs` for the acceptance check. It builds both images, starts a disposable MongoDB and the web server on an isolated internal Docker network, and requests the real landing page and public assets from a separate container. It also runs the worker for ten seconds with a queued local request and unavailable RPCs, then verifies that MongoDB contains the retry and that the worker released its lease. Cleanup must succeed before the check reports `PACKAGING_VERIFIED`.

The driver independently reran this check on 2026-10-26. This evidence closes R06's packaging defect; hosted mainnet deployment and live semantic reliability remain separate release requirements.

The October 29 clean GitHub run exposed a newer-kernel incompatibility in the previously pinned MongoDB 8.0.32 fixture. Startup diagnostics now report container state and actual logs, with a bounded readiness wait. The disposable fixture is pinned to official MongoDB 7.0.45 by its multi-platform image digest; this changes no hosted database. MongoDB's [kernel compatibility report](https://jira.mongodb.org/browse/SERVER-125742) identifies the 7.0 line as supported across the affected kernels and explains the [8.x tcmalloc failure](https://jira.mongodb.org/browse/SERVER-121912). The same real HTTP, durable retry and lease-release checks remain required.
