# Official CPU and DeWEB continuation

The existing X Layer **1952** deployment uses IntentGuard's TapeOut VM adapter. It remains a mandatory payment-authorization gate and is preserved with its policies, balances and history. Official TapeOut CPU registration and DeWEB publication target X Layer **196**. Both payment environments use **GenLayer Studionet 61999 testnet simulator infrastructure**; mainnet payments do not imply GenLayer mainnet review.

The staged execution procedure and role isolation are in [MAINNET-DEPLOYMENT.md](MAINNET-DEPLOYMENT.md). `node tools/production/verify-release-continuation.mjs` verifies local deployment, hosting, receipt and live-verifier regressions. It neither spends funds nor produces live release evidence. Official addresses, frozen beacon, code hashes and circuit bytes are pinned in `tools/hosting/pins.json`; the reviewed TapeKit source is commit `37c617e7e332787c8a32a81e4d7d05a28a06c156`.

Use a clean committed source checkout and rebuild the final artifacts before quotation. Obtain a new five-minute exact quote for each dependent stage, verify an isolated funded signer, and obtain the user's explicit native/token spending **cap** for that quote. The selected public deployer address is not spending authorization. CPU creation, transistor minting, tapeout, opening, uploads and subscription activation are separate stages. Opener and transistor payable interfaces require reviewed actual source/ABI/runtime evidence; unknown or guessed fees cannot become executable quotes. Future dependent costs remain unresolved until predecessors exist.

Execution persists intent and signed bytes before broadcast in a private journal. Reconcile the original stage/hash after an interrupted response; never delete or replace a journal to retry. Publish public receipt identities without credentials or raw signed transactions. Factory, registry and subscription administrators remain mutable even though the circuit beacon is frozen.

## Live evidence manifest

Create `.local/dual-release/live-manifest.json` only from actual confirmed outputs. Its version1 scope is `intentguard-dual-release-live-evidence`. Required root fields are `sourceCommit`, `sourceTreeSha256`, mainnet `releaseId`, `journal: {path,sha256}` and `cpu: {processor,owner,cpuIndex,circuitId}`. Registry IDs are exact decimal strings. Hash-pinned file paths must be relative to this checkout, bounded, regular and without symlinks. The journal is private; the verifier prints only public results.

Run the read-only verifier from the exact clean source:

```sh
node tools/production/verify-release-live.mjs --require-cpu .local/dual-release/live-manifest.json
node tools/production/verify-release-live.mjs --require-acceptance .local/dual-release/live-manifest.json
node tools/production/verify-release-live.mjs --require-hosting .local/dual-release/live-manifest.json
```

CPU verification refetches the journal's `createCPU` and `tapeout` transactions and exact receipt outputs. Current registry index, owner, frozen beacon, implementation, processor/transistor code and pinned 451-input/8-output/1766-gate NAND netlist must agree. It executes **490 deterministic vectors on the actual official CPU**, checked against separate bigint predicates: all128 failure combinations, uint64/time boundaries, every amount bit, and256 seeded full-width inputs. A block reorg, incorrect output, stale source or changed receipt fails. Local mock RPC results never qualify these commands as actual registration.

Acceptance adds `releases`, exactly one testnet and one mainnet. Each binds payment environment/chain, the same exact `sourceCommit`, `releaseId`, canonical `applicationOrigin`, published `frontendOrigins`, UTC `deployedAt`, and `allowedTokens`. Mainnet also binds `processor` and `circuitId` and must allow both native USDC and USDT0. Actual health/config must expose current source/release, reachable database, fresh worker, explicit origins and all intended destinations. Config assets use `available: true`. Both factory addresses and mainnet guard pins must match verified deployment outputs.

`acceptance: {path,sha256}` references the dual live acceptance manifest described in [dual-release-acceptance.md](../security/dual-release-acceptance.md). Two independently generated current rounds per environment and reviewed actual operational/recovery/legacy traces remain mandatory. Separately scoped audit keys only refetch saved inputs; no key is written into reports.

`canaries` contains one local USDT0 payment, one local USDC payment and ten USDC CCTP destination payments. Each entry has `asset`, `destinationChainId`, a unique `requestId`, hash-pinned `input`, and `vaultStageKey` such as `createCanaryVault:usdc`. The private journal must contain that verified vault stage. The verifier binds its actual factory, policy, CPU, asset and allowed destinations to the issued agent, then independently checks the finalized reviewer and actual delivery proof. Historical, merely admitted, burned or unacknowledged requests cannot satisfy a canary.

## Publishing the frontend

Build the frontend with `scripts/static-frontend.mjs --final`, using the actual mainnet API and future gateway origin. Preserve the returned directory and manifest. `hosting` has `frontendManifest: {path,sha256}`, `frontendDirectory`, `gatewayOrigin`, `fallbackOrigin`, and `browserReview: {path,sha256}`. The gateway is the actual `<circuitId>-2-<cpuIndex>.tapekit.org` HTTPS origin. Configure the API's explicit frontend allowlist for the gateway and identical-artifact fallback; environment links never transfer sessions.

Publication refetches `transferCircuit`, `openContainer`, `setFallback` and `activateFrontend` receipts, enumerates every registry path, verifies every chunk/hash/MIME/size and fallback, and checks that the actual subscription is current. The final frontend's complete client source-input hashes must match the clean checkout. Extra onchain paths or changed bytes fail. Uploads are resumable and never overwrite a conflicting existing path.

The default TapeKit gateway returns a bootstrap shell to ordinary HTTP clients. Its **Service Worker** reads and verifies the onchain files in the visitor's browser. Verify every file and deep route through that controlled browser, requiring `x-tape-mode: client`, verified hashes and the actual gateway identity; compare all fallback bytes with the same final artifact. The pinned gateway version permits and records offchain API access by default. It has no separate external-API permission approval screen.

The fresh reviewed hosted-browser record has kind `reviewed-live-hosted-browser-evidence`, exact source/bundle/gateway/fallback identities, `reviewedAt`, `reviewedBy`, `reviewReference`, and six hash-pinned actual traces: `gateway-api-access`, `gateway-owner-login`, `fallback-owner-login`, `mobile-onboarding`, `wallet-rejection-recovery`, and `card-detail-navigation`. The API-access trace inspects TapeKit's external-access recording and actual config/CORS behavior. Owner wallet dialogs remain explicit. A generated fixture or passed boolean cannot stand in for review of these live actions.

Only after the final releases and hosted behavior verify should the **72-hour** Ubuntu/Windows/macOS campaign start; see [AVAILABILITY.md](AVAILABILITY.md). The three operating systems share GitHub Actions infrastructure. Registration, publication, complete live acceptance and sustained availability remain unverified until their actual receipts, traces and full time window exist. The historical10/12 audit and later8/8 testnet run remain unchanged.
