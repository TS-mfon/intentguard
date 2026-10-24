// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Public faucet token with no monetary value, only for X Layer testnet.
contract TestnetUSDT {
    string public constant name = "IntentGuard Testnet USD";
    string public constant symbol = "TEST-USDT";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function mint(address to, uint256 amount) external {
        require(to != address(0) && amount <= 100_000 * 10 ** 6, "testnet faucet limit");
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "zero recipient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
