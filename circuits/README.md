# Exact spending policy circuit

Generate with `node circuits/policy.mjs`; verify with `node tools/check.mjs circuit`.
The generated artifacts are reproducible and use no synthesis service or model.

Seven unsigned 64-bit values occupy offsets 0, 64, 128, 192, 256, 320, 384:
amount, perPaymentLimit, remainingTotal, remainingPeriod, validFrom, now, validUntil.
Flags occupy 448, 449, 450: recipientAllowed, assetAllowed, enabled. Uint64 values
and input/output bit packing are little endian. The 57-byte input has five unused
high bits set to zero. Netlist signal indices themselves are big-endian u24.

The comparator is a NAND circuit over all 64 bits, never a precomputed permission
flag. Outputs are allow at bit 0; failure bits 1..7 are perPayment, total, period,
time, recipient, asset, enabled. Time uses validFrom <= now < validUntil.
Zero amounts are valid in the numeric circuit; the vault rejects zero payments.

Constants occupy signals 0 and 1, inputs start at signal 2, and every opcode 0
produces one signal. The eight output signals are the final eight signals, as
required by TapeOut NetlistVM. Hash pin is SHA-256 of raw netlist bytes, matching
AgentSpendingCard.expectedNetlistHash.

The deployment field remains NOT_DEPLOYED until a real owner-approved TapeOut
transaction completes. LocalNandProcessor executes the genuine TapeOut NetlistVM
for local testing and carries no claim of deployment or mainnet proof.
