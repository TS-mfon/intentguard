// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Independent arithmetic oracle for tests only; never used by live cards.
library PolicyReference {
    function eval(bytes memory inputs) internal pure returns (uint8 result) {
        require(inputs.length == 57, "reference input length");
        uint64[7] memory v;
        for (uint256 f; f < 7; ++f) for (uint256 b; b < 8; ++b)
            v[f] |= uint64(uint256(uint8(inputs[f * 8 + b])) << (b * 8));
        uint8 fail;
        if (v[0] > v[1]) fail |= 1;
        if (v[0] > v[2]) fail |= 2;
        if (v[0] > v[3]) fail |= 4;
        if (!(v[4] <= v[5] && v[5] < v[6])) fail |= 8;
        if ((uint8(inputs[56]) & 1) == 0) fail |= 16;
        if ((uint8(inputs[56]) & 2) == 0) fail |= 32;
        if ((uint8(inputs[56]) & 4) == 0) fail |= 64;
        return fail == 0 ? 1 : fail << 1;
    }
}
