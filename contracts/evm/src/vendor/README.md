# TapeOut oracle provenance

ICPU.sol and NetlistVM.sol are unmodified MIT-licensed TapeOut protocol sources mirrored by
https://github.com/OoJae/covenant/tree/main/contracts/vendor/tapeout-xlayer .
Fetched October 24, 2026. That mirror records verified X Layer implementation
0x977f217887E085D298Cb3819cDAD5A0ee35F29B2, circuit beacon
0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C, factory
0x1f09daefa827f02cbb40967cc91b259763760761. These are reference addresses, not an
IntentGuard deployment or current-chain verification.

The live vault calls the configured ICPU processor. LocalNandProcessor uses the
actual NetlistVM as an independent test oracle and is only for local development.
