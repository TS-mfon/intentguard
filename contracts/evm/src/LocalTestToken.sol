// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Six-decimal token for isolated integration tests; never production USDT.
contract LocalTestToken {
    string public constant name = "IntentGuard local test token";
    string public constant symbol = "TEST-USDT";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount; totalSupply += amount; emit Transfer(address(0), to, amount);
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "zero recipient");
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount); return true;
    }
}
