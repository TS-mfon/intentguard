# Mainnet product activation

The initial release enables native USDC payments on X Layer 196 only. The user selected local payments on 2026-11-12 and funded only USDC. USDT0 and cross-chain CCTP destinations remain disabled until their separately funded live acceptance succeeds. Semantic review runs on GenLayer Studionet 61999 testnet simulator infrastructure.

Confirmed factories and CPU 414/circuit 4 are recorded in `docs/deployments/mainnet-contracts-and-circuit.json`. The separately deployed version 3 permission interpreter and the initialized database identities are recorded in `mainnet-interpreter-integration.json` and `mainnet-database-integration.json` in the same directory. These records do not certify application activation or payment acceptance.

The isolated mainnet API uses `intentguard_mainnet` and its dedicated API principal. The worker uses the dedicated worker principal and separately generated gateway, attestor and review-operator keys. Testnet retains its database, signing keys and canonical application origin. The mainnet canonical origin is `https://intentguard-mainnet.vercel.app`.

Serverless hosting may provide the exact public runtime manifest bytes as `INTENTGUARD_VERIFIED_MANIFEST_JSON`. Alternatively, workers may use `INTENTGUARD_VERIFIED_MANIFEST` to name a packaged file. Configure exactly one source and set `INTENTGUARD_VERIFIED_MANIFEST_SHA256` to the SHA-256 of its exact bytes. Both transports perform the same strict JSON, source, contract, environment and capability validation; supplying both is rejected. A prepared candidate manifest must not be installed as accepted production evidence before the intended routes pass their live checks.

The admitted USDC beta is deployed at the canonical origin, and the isolated worker and product navigation are enabled. One controlled 0.0001 USDC payment, a numerical budget block, explicit category rejection, injection withholding and safe cancellation after validator disagreement have recorded evidence. The test vault is revoked and the test funds have been returned.

The user stopped the additional gas-dependent hosted payment and further acceptance checks. No additional funding was executed. Further mainnet payments require worker OKB; a successful hosted payment and full browser acceptance are not certified. [The release record](MAINNET-APPLICATION.md) documents the deployed scope and limitations. The broader DeWEB, cross-chain and sustained availability campaign remains separate.
