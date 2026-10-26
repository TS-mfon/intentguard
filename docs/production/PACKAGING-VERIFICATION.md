# Web and worker packaging verification

The default Docker target serves the actual Next.js application. `--target worker` creates the separate queue executor. Both run as the unprivileged `node` user and share Node 24.18.0 pinned by image digest and pnpm 11.9.0 with the frozen lockfile. Credentials are provided at runtime and excluded from the build context.

Run `node tools/production/verify-packaging.mjs` for the acceptance check. It builds both images, starts a disposable MongoDB and the web server on an isolated internal Docker network, and requests the real landing page and public assets from a separate container. It also runs the worker for ten seconds with a queued local request and unavailable RPCs, then verifies that MongoDB contains the retry and that the worker released its lease. Cleanup must succeed before the check reports `PACKAGING_VERIFIED`.

The driver independently reran this check on 2026-10-26. This evidence closes R06's packaging defect; hosted mainnet deployment and live semantic reliability remain separate release requirements.
