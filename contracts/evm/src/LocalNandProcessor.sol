// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICPU} from "./vendor/interfaces/ICPU.sol";
import {NetlistVM} from "./vendor/lib/NetlistVM.sol";

/// @notice Local development oracle; production cards must use the TapeOut CPU.
contract LocalNandProcessor is ICPU {
    bytes private _netlist;
    uint256 public constant CIRCUIT_ID = 1;

    constructor(bytes memory nl) {
        (uint256 nNand, uint256 nLatch,,) = NetlistVM.analyze(nl, 451, 8, address(0));
        require(nNand > 0 && nLatch == 0, "combinational NAND required");
        _netlist = nl;
    }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory outputs) {
        require(id == CIRCUIT_ID && inputs.length == 57, "invalid local circuit inputs");
        (, outputs) = NetlistVM.run(_netlist, 451, 8, "", inputs);
    }

    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external view returns (bytes memory newState, bytes memory outputs) {
        require(id == CIRCUIT_ID && state.length == 0 && inputs.length == 57, "invalid local inputs");
        return NetlistVM.run(_netlist, 451, 8, state, inputs);
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        require(id == CIRCUIT_ID, "unknown circuit");
        return (451, 8, 0, uint32(_netlist.length / 7));
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        require(id == CIRCUIT_ID, "unknown circuit");
        return _netlist;
    }

    function transistors() external pure returns (address) { return address(0); }
}

/// @notice Beacon pin adapter for a direct local processor implementation.
contract LocalProcessorBeacon {
    address public immutable implementation;
    constructor(address impl) { implementation = impl; }
}
