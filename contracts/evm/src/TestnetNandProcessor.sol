// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LocalNandProcessor, LocalProcessorBeacon} from "./LocalNandProcessor.sol";

/// @notice Testnet adapter executing the unchanged TapeOut NetlistVM.
/// This is not an official TapeOut CPU registry deployment and has no mainnet role.
contract TestnetNandProcessor is LocalNandProcessor {
    constructor(bytes memory netlist) LocalNandProcessor(netlist) {}
}

/// @notice Immutable testnet implementation pin for the direct processor.
contract TestnetProcessorBeacon is LocalProcessorBeacon {
    constructor(address implementation) LocalProcessorBeacon(implementation) {}
}
