# Staged mainnet execution

`scripts/mainnet-deploy.ts` runs exact, source-bound deployment stages. This is tooling, not a deployed release. No mainnet transaction, paid provisioning, application spending activation, customer payment or semantic audit is certified by the tooling regression suite.

The payment chain is X Layer196. Native USDC can settle locally and through the approved CCTP destination subset. USDT0 remains local to X Layer196. Interpreter and V4 reviewers run on GenLayer Studionet61999, which is testnet simulator infrastructure. Every Studionet quote, execution recheck and receipt block pin checks both chain61999 and the configured genesis response before observing current state. Its zero genesis hash does not establish reset resistance, and its single endpoint does not provide independent finality verification.

## Prepare an exact stage

Commit all public source first. Preparation and execution require a clean current HEAD, the exact source tree, Node24.18.0, pinned TapeKit source/runtime, and compiled release artifacts from `scripts/release-prepare.ts`. Private stage quotes, approvals and journals belong under `.local/`; do not commit raw signed transactions or credentials.

A CPU-only config requires the actual public deployer address and no future wallet secrets:

```json
{
  "stage": "createCPU",
  "principals": {
    "deployer": "<actual lowercase X Layer deployer address>"
  }
}
```

The address placeholder is deliberately not an executable example or a fabricated wallet. Save a real config to `.local/mainnet-cpu-config.json`, then run:

```sh
pnpm exec tsx scripts/mainnet-deploy.ts quote .local/mainnet-cpu-config.json
```

Review and save the returned JSON verbatim to a private quote file. It contains the source commit/tree, release identity, role/sender, nonce, exact calldata/value, agreed pinned block, simulation result, gas estimate, gas limit, fixed legacy gas price, and maximum native cost. The cost is `value + gasLimit × gasPrice`; its five-minute expiry and repeated live checks are mandatory. The two independent mainnet providers must agree on state observations. Gas-price recommendations are independently recorded; the fixed signed ceiling uses the larger measured value, so recommendation disagreement is visible and does not create an unbounded fee. State disagreement, insufficient balance, stale source, malformed responses or failed simulation leaves the stage unquoted. The separate read-only release-preparation report may show historical fees or unresolved dependent costs; it cannot substitute for this executable quote.

Read-only quotation needs no installed signer. Execution requires a separate explicit user spending cap for the exact stage and quote, recorded through its user-message reference. The executable does not generate an approval. The approval JSON has these exact fields:

| Field | Required value |
|---|---|
| `version`, `kind` | `1`, `user-approved-exact-deployment-stage` |
| `releaseId`, `quoteHash`, `stageKey` | Exact reviewed quote values |
| `chainId`, `sender`, `role` | Exact quote chain, public sender and role |
| `maximumNativeWei` | User-approved decimal cap, at least the quoted maximum |
| `maximumTokenCost` | Exact quoted token/recipient/amount object, or `null` |
| `approvedBy`, `authorizationReference` | `user`, actual approval-message reference |
| `approvedAt`, `expiresAt` | Unix milliseconds inside the current quote lifetime |

Add `quotePath` and `approvalPath` to the config only after that approval exists. Load the matching dedicated role key into the process through the established private credential mechanism:

| Role | Signing variable |
|---|---|
| deployer | `INTENTGUARD_MAINNET_DEPLOYER_PRIVATE_KEY` |
| owner | `INTENTGUARD_MAINNET_OWNER_PRIVATE_KEY` |
| review operator | `INTENTGUARD_MAINNET_GENLAYER_OPERATOR_PRIVATE_KEY` |

Public `gateway` and `attestor` pins are added before vault construction. Every declared role must use a distinct address; once a role appears in a journal, it cannot change or be reused for another role. A first CPU stage does not require unrelated future role addresses. Generic/testnet deployment keys are never selected automatically.

```sh
pnpm exec tsx scripts/mainnet-deploy.ts execute .local/mainnet-cpu-config.json --broadcast
```

The executable rechecks source bytes, protocol code/implementation/admin/fee state, dependencies, calldata, simulation, gas ceiling, nonce and balance. It fsyncs an intent before signing, validates every signed field and recovered signer, then fsyncs the raw/hash before any broadcast. One release-private journal lock prevents concurrent writers. A retry recovers the exact signed bytes. It cannot sign a replacement nonce, use another target, increase its gas fee, exceed the approved native/token scope or switch environments. Receipt verification normalizes ABI-declared address fields before comparing their exact identities, so valid checksum-form CPU, circuit, vault and funding events remain verifiable; sender, recipient and amount mismatches still fail. The ERC6551 container's decoded token tuple separately binds chain196, the exact normalized processor address and circuit ID.

## Stage order and dependencies

| Stage | Role | Fee and inputs required before quotation | Independent receipt/output verification |
|---|---|---|---|
| `createCPU` | deployer | Live official `deployFee`; 10000 transistor supply, zero mint price; actual funded sender/nonce | Unique official `CPUCreated`, registration/index, frozen beacon slot, processor/transistor code hashes |
| `deployUSDCFactory` | deployer | Compiled `CctpCardFactoryV4` creation image and exact gas | CREATE address, runtime outside compiler immutable slots, chain196, both STOP-prefixed code stores and reconstructed V4 card image |
| `deployUSDT0Factory` | deployer | Compiled `MainnetUsdt0CardFactory`, live native token constructor simulation | Exact runtime, chain196, official USDT0 address and immutable token code hash |
| `mintTransistors` | deployer | Verified CPU; reviewed deployed transistor source/ABI/runtime; actual missing balance, `mintPrice × amount + protocolFee` | Receipt and increased owner transistor balance |
| `tapeout` | deployer | Verified CPU, enough1766 transistors, pinned NAND bytes, live `TAPEOUT_FEE`; mint is unnecessary if balance already suffices | Unique `TapedOut`, owner, exact netlist/hash and 451/8/0/1766 dimensions; live independent circuit vectors remain a separate required gate |
| `transferCircuit` | deployer | Verified circuit; separate public owner; quoted ERC721 `safeTransferFrom` | Actual circuit owner becomes the isolated owner |
| `openContainer` | owner | Verified circuit/ownership; reviewed payable opener ABI/source/runtime; live `FEE()` | Actual `isOpened`, deterministic account, ERC6551 token tuple and registry acceptance |
| `uploadFrontend` | owner | Verified opened site; final static directory/API origins/path; one actual pending chunk and exact storage-call gas | Existing chunks are read and hashed; receipt verifies the new chunk; a conflicting existing file is refused |
| `setFallback` | owner | Same source-bound bundle and quoted registry call | Registry fallback matches bundle |
| `activateFrontend` | owner | Every uploaded file/fallback verified; source/bundle-bound browser acceptance;1–12 months, live monthly fee | Container subscription expiry; real gateway/availability testing remains separate |
| `deployInterpreter` | review operator | Exact interpreter source and operator constructor; SDK capture followed by mandatory actual call/gas simulation | Finalized validator consensus, exact committed source/constructor and public operator |
| `deployReviewer` | review operator | Exact V4 source; reviewer ID, policy/hash, asset and sorted same-environment destinations | Finalized committed source/constructor, operator, version4, payment chain196, token, policy and settlement/profile hashes |
| `createCanaryVault` | owner | Verified circuit and compiled factory; exact owner/gateway/attestor/config, canary ID/asset/destinations; future activation window | Factory receipt, complete runtime/config/recipient and destination bindings; semantic acceptance remains separate |
| `pauseCanary` | owner | Verified owned canary and exact `setEnabled(false)` call | Actual owner pause state is false |
| `fundCanary` | owner | Verified owned, explicitly paused canary and explicit token amount in atomic units | Exact token Transfer receipt and actual vault balance increase |

The CPU quote records the next factory index as an observation. Another account can create a CPU after signing and before mining; that changes creation order without changing the signed call. Receipt verification resolves the unique actual processor index from the append-only factory registry at the receipt block, starting at the quoted index and scanning at most256 entries in batches of16. Missing or ambiguous registration, a lookup beyond that bound, a different creator or changed CPU arguments fails acceptance. Dependent TapeOut and DeWEB stages use this verified actual index. Sections1 and3.3 of [the pinned TapeKit specification](https://github.com/TapeOutProtocol/TapeKit/blob/37c617e7e332787c8a32a81e4d7d05a28a06c156/SPEC.md) define the append-only numbering and absence of a reverse table.

Config fields for dependent stages are `dependencyEvidence`; `frontendDirectory`, `apiOrigins`, `path`; `months`, `browserAcceptance`; `reviewer`; or `asset`, `cardConfig`, `destinations`, `canaryId`, `amountUnits`, as appropriate. These inputs are included in the exact operation/quote hash. Public network identities are derived from verified prior receipts, not supplied as arbitrary processor/factory addresses.

The official pinned TapeKit files document opener reads but omit its payable opening ABI/source. The checked Sourcify full-match metadata URL returned404 on2026-10-29. `openContainer` therefore requires reviewed dependency evidence before construction: exact address/runtime SHA256, source file/hash, unambiguous payable `open(address,uint256)` ABI, reviewer identity and review reference. If the verified implementation uses a different opening interface, update and independently review the stage constructor before spending. The newly deployed transistor contract also requires its actual reviewed mint ABI/source/runtime. A caller-provided selector or guessed payable fee cannot bypass these checks. CPU creation/factory deployment can be quoted without those future inputs.

## Pending receipts, recovery and public release binding

Execution returns `PENDING`, `CONFIRMING` or `PENDING_FINALITY` while retaining the exact signed transaction. Reconcile with the same source/config and stage key:

```sh
pnpm exec tsx scripts/mainnet-deploy.ts reconcile .local/mainnet-cpu-config.json
```

For chunk, reviewer or vault stages, set the exact `stageKey` returned by the quote. Reconciliation is read-only and works after quote/approval expiry. It queries the original hash, checks the signed transaction, requires two EVM confirmations, checks the exact receipt block and output, and cannot create or broadcast another payment. An absent signed transaction after expiry needs renewed exact authorization and safe operator reconciliation; this version refuses to replace a journalled stage with a different quote or nonce. Inspect the exact journal lock PID before recovering an abandoned lock; never delete a live lock or clear the deployment directory.

`VERIFIED` certifies only that stage's receipt and declared output. Circuit vectors, reviewer semantic acceptance, DeWEB browser compatibility, three-environment availability, all ten real destination canaries, owner controls, crash recovery, bridge proofs and two fresh qualifying live audits remain release requirements. The original10/12 audit is unresolved until those audits pass; the later8/8 testnet audit does not close it.

Do not bind `docs/deployments/mainnet.json`, API/frontend origins, database marker, worker principals or enabled destinations from a planned address or simulated return. Use verified public outputs and current code/config hashes; preserve chain1952/database `intentguard` separately from chain196/database `intentguard_mainnet`. Final release binding and funded-state backup acceptance are driver integration work. Keep the mainnet worker and public spending disabled until all security/reviewer/issuer/canary gates are met.

The canary constructor requires `validFrom` at least24 hours ahead, which blocks immediate spending; this is a preparation window, not permanent disablement. Configure the release worker disabled, and run `pauseCanary` and the owner control acceptance before any funding or activation. `fundCanary` refuses an enabled vault. Final acceptance must explicitly verify the actual owner state rather than infer it from deployment tooling.

The user selected public deployment quote sender `0xEd9EDd8586b20524CafA4F568413C504C9B03172` on2026-10-29. The private CPU-only configuration stores its canonical lowercase form. This selection provides the quote sender and does not approve spending or authorize automatic reuse of a testnet key. Current preparation has no dedicated mainnet role key in the process or inspected known env files. Verified funded role identities, actual complete stage quotes, explicit user caps, reviewed dynamic payable source, public receipts and live acceptance remain pending. None is fabricated by `verify-mainnet-deploy.mjs`.
