# IntentGuard testnet deployment

The hosted demo uses X Layer testnet (chain 1952, https://testrpc.xlayer.tech) and GenLayer Studionet (chain 61999, https://studio.genlayer.com/api). It never spends mainnet assets.

The known TapeOut mainnet factory has no code at its address on X Layer testnet. The testnet processor therefore executes the generated NAND circuit through the unchanged vendored TapeOut NetlistVM in a plainly named TestnetNandProcessor. This demonstrates the genuine evaluator but does not claim an official TapeOut CPU registry or mint/tapeout deployment. Mainnet integration remains a separate implementation path.

Payment token TEST-USDT is a six-decimal, public-faucet token with no monetary value. Its faucet permits minting test units. Owners activate the same spending vault and every payment still requires numeric reservation and finalized GenLayer evidence review.

```sh
forge build --root contracts/evm
pnpm exec tsx scripts/testnet.ts check
pnpm exec tsx scripts/testnet.ts deploy --broadcast
pnpm exec tsx scripts/testnet.ts verify
```

Deploy reads only the authorized build environment (default /home/sudodave/.env.build). Chain identities are checked before deployment; testnet configuration refuses chain 196. The public manifest is .local/testnet-deployment.json. Private signing state and generated attestor key are stored with mode0600 in .local/testnet-journal.json and .local/testnet-secrets.env; never publish these files.

The supplied funded key acts as testnet deployer, X Layer gateway and Studionet operator. The independent attestor key only signs release attestations and needs no gas. Deployment transaction bytes are persisted before broadcasting so reruns resume the same transactions. GenLayer deploy must complete successful FINALIZED validator consensus before the interpreter is published.

Web configuration uses INTENTGUARD_MODE=testnet, XLAYER_CHAIN_ID=1952, PAYMENT_TOKEN and the public deployed addresses. Signing keys belong only to the GitHub Actions worker. The GenLayer reviewer must be deployed with immutable chain1952 and this test token; a mainnet reviewer must not authorize testnet requests.

Local deployment RPC calls use a domain-restricted curl fallback because the host’s Node TLS connection can fail while curl succeeds. Signed payloads go through stdin, never CLI arguments or logs. Set INTENTGUARD_DEPLOY_CURL=0 to use native fetch on another host. This fallback is confined to the deployment script; the hosted worker retains its normal SDK transport.

X Layer testnet can temporarily report a pending nonce lower than the confirmed latest nonce. The deployer selects the greater value. If an unmined journal transaction is permanently invalid because a confirmed deployment in the same journal already consumed its nonce, it records the superseded transaction and prepares a new one. Unknown externally consumed nonces stop recovery for investigation.

## Verified public contracts

Verified at 2026-10-24T20:17:36.955Z. X Layer1952 and Studionet61999 identities, exact EVM creation code/constructors, runtime hashes, circuit bytes, positive/negative evaluation and finalized interpreter source/operator all passed.

| Contract | Address | Deployment transaction |
|---|---|---|
| NAND processor | 0xa34d101011d4dbe18375ff2e7591b646e22c2ff3 | [0x7e8a46f8ab635267fa82c335229c9b4f8dd709fd305a2391155cd5380e5a8f34](https://www.oklink.com/xlayer-test/tx/0x7e8a46f8ab635267fa82c335229c9b4f8dd709fd305a2391155cd5380e5a8f34) |
| Immutable beacon | 0x699f57090c5c74acc3b7f7f2fdc4f808ff6a010f | [0x4380cf5c8f67e38bf84dd28bed621ee62fcc62686e131aafa6f34ca309480466](https://www.oklink.com/xlayer-test/tx/0x4380cf5c8f67e38bf84dd28bed621ee62fcc62686e131aafa6f34ca309480466) |
| TEST-USDT | 0x47f846c659b4df565d2e8b1cd32f610e68d11b9a | [0x7949b013601dd122628d57375efe4c7d06c9ff28d8d1a0fedb9eb4da625f1fb8](https://www.oklink.com/xlayer-test/tx/0x7949b013601dd122628d57375efe4c7d06c9ff28d8d1a0fedb9eb4da625f1fb8) |
| Vault factory | 0xb452f9fabdf1599b2c72acbad0fc52baac58dfb7 | [0xe9537c04dd441ad5e7f1c33ab6ea15d752703ff118da1d4d49e90fc4cb2f96ea](https://www.oklink.com/xlayer-test/tx/0xe9537c04dd441ad5e7f1c33ab6ea15d752703ff118da1d4d49e90fc4cb2f96ea) |
| GenLayer interpreter | 0x0922B814Cd91a9f2fF36F95D321A74eA22CEa9d3 | [0x15c6f64fa7893e9943f6736b7f6ab014d0039e126d55e53351299610c1d9494a](https://explorer-studio.genlayer.com/transactions/0x15c6f64fa7893e9943f6736b7f6ab014d0039e126d55e53351299610c1d9494a) |
