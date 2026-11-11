# Mainnet product activation

The initial release supports USDC and USDT0 payments on X Layer 196 only, as selected by the user on 2026-11-12. Cross-chain CCTP destinations remain disabled until their separately funded live acceptance succeeds. Semantic review runs on GenLayer Studionet 61999 testnet simulator infrastructure.

Confirmed factories and CPU 414/circuit 4 are recorded in `docs/deployments/mainnet-contracts-and-circuit.json`. The separately deployed version 3 permission interpreter and the initialized database identities are recorded in `mainnet-interpreter-integration.json` and `mainnet-database-integration.json` in the same directory. These records do not certify application activation or payment acceptance.

The isolated mainnet API uses `intentguard_mainnet` and its dedicated API principal. The worker uses the dedicated worker principal and separately generated gateway, attestor and review-operator keys. Testnet retains its database, signing keys and canonical application origin. The mainnet canonical origin is `https://intentguard-mainnet.vercel.app`.

Serverless hosting may provide the exact public runtime manifest bytes as `INTENTGUARD_VERIFIED_MANIFEST_JSON`. Alternatively, workers may use `INTENTGUARD_VERIFIED_MANIFEST` to name a packaged file. Configure exactly one source and set `INTENTGUARD_VERIFIED_MANIFEST_SHA256` to the SHA-256 of its exact bytes. Both transports perform the same strict JSON, source, contract, environment and capability validation; supplying both is rejected. A prepared candidate manifest must not be installed as accepted production evidence before the intended routes pass their live checks.

Mainnet activation still requires funded local USDC/USDT0 payments, owner control and recovery evidence, a fresh worker heartbeat, hosted configuration/health checks and actual browser verification. The dedicated deployer has no USDC or USDT0 at the last inspection. Keep the mainnet worker and product navigation disabled until these checks pass. The broader DeWEB, cross-chain and sustained availability campaign is separate from this initial local-payment release; its historical evidence remains unchanged.
