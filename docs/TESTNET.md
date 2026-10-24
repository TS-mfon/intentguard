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
