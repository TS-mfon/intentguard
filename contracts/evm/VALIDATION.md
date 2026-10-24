# EVM and circuit validation

Validated October 24, 2026.

- `node tools/check.mjs evm`: EVM_CHECK_PASSED, 40 tests, 0 failed;
  independent real TapeOut VM fuzz comparison: 64 runs.
- `node tools/check.mjs circuit`: CIRCUIT_CHECK_PASSED; six Node test cases
  cover integer boundaries, each uint64 bit, inclusive/exclusive time boundaries,
  all 128 failure bitmaps, 6,000 deterministic random vectors and malformed inputs.
- `pnpm exec tsx contracts/evm/integration.ts`: EVM_INTEGRATION_CHECK_PASSED,
  12.349 seconds. Real Evm adapter on isolated Anvil, six-decimal test token, genuine
  TapeOut NetlistVM, exact EIP712 release, idempotent transaction recovery,
  invoice/release replay rejection, two pending requests, period budget and
  lifetime reservations across rollover. GenLayer finality is explicitly a
  synthetic test-only fixture.
- Standalone integration strict TypeScript compilation passed.

Circuit: 1,766 NAND gates; 2,219 signals; 144 gate levels; 12,362 raw netlist bytes.
SHA-256: `0x280890411f873d9cf1e113c5edf783c18b14d4f9485c567a7d0ec2d45292a761`.
Independent Node arithmetic and Solidity arithmetic references are test-only.
The production permission gate calls the configured TapeOut ICPU.eval.

Compiled runtime sizes:
AgentSpendingCard 13,679 bytes; CardFactory 18,046 bytes;
LocalNandProcessor 6,790 bytes; LocalTestToken 902 bytes. Each is below EIP-170.
The local storage-backed oracle requires about 4.44 million gas per evaluation;
this is a fixture measurement, not a mainnet gas estimate.

The four implementation passes completed:
1. Full circuit, vault, factory, fixed interfaces and local oracle.
2. Review of authorization, committed balances, signature binding, foreign-chain
   trust, replay, period rollover, evaluator pinning and independent withdrawal.
3. Corrections: Foundry impersonation was consumed by a test-fixture SHA-256
   precompile; configuration now permits a period budget stricter than its
   per-payment ceiling; the gateway adapter's nested evaluation gas estimate
   needed a cushion before signing (implemented by root in its owned adapter).
4. Polished ABI handoff, reproducible artifacts, local integration, documentation
   and final acceptance checks.

No mainnet deployment or broadcast occurred. integration-report.json describes a
terminated private test chain and contains no usable wallet secrets. Real
GenLayer finality and evidence consensus remain the production attestor/worker's
responsibility. This engineering review is not an external security audit.
