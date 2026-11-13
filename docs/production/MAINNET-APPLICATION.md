# Mainnet USDC beta release

The mainnet product is deployed at https://intentguard-mainnet.vercel.app. The existing testnet product at https://intentguard-tapeout.vercel.app links to it through Payment environment. Native Circle USDC on X Layer mainnet (196) is the enabled asset and destination.

The application source is ba69eae8d57279ea9e2f84630f6cb33b71c398b4. Its recorded 59 focused tests, TypeScript check and production build passed. The final Vercel deployment is dpl_49i6VzaqSeYvXo17AkoXzjAu45Xo.

A controlled 0.0001 USDC payment reached the deployer through local API admission and the live cloud worker. The numerical budget block, explicit advertising-category rejection, injection withholding and duplicate protection were verified. Two prose-only advertising reviews failed validator consensus and cancelled without payment.

The first hosted payment review also failed validator consensus without paying. Its retry could not reserve because the worker lacked sufficient gas. The user requested skipping additional funded testing, stopping further checks and pushing the release. The retry is cancelled, no additional funding was executed, and the six final acceptance gates remain explicitly abandoned. Further mainnet payments require additional worker OKB; successful hosted payment and full browser acceptance are not certified.

The test vault is revoked with zero available and reserved funds. The complete 0.001 USDC test allocation returned to the deployer through the confirmed payment and withdrawal. Remaining test-owner OKB was also returned. Pause, resume, owner-only controls, withdrawal and credential revocation have recorded evidence.

The mainnet circuit is circuit 4 on official frozen CPU 414, owned by the deployer. Semantic review remains GenLayer Studionet (61999) testnet simulator infrastructure. USDT0 and cross-chain spending destinations remain disabled. The earlier Arc CCTP transfer funded the deployer; it did not enable Arc as a payment destination. DeWEB publication and broader production acceptance remain separate work.

See [the release record](../deployments/mainnet-application.json) for transaction hashes, source identity, recovered funds, prior attempts and the explicit skipped scope.
