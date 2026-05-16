// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title FreeSubnameRegistrar for memescope.eth
/// @notice Allows anyone to register a free subname on Base L2 via Durin
/// @dev Deploy on Base. The L2Registry must addRegistrar(this) after deployment.

interface IL2Registry {
    function register(string calldata label, address owner) external;
    function available(string calldata label) external view returns (bool);
}

contract FreeSubnameRegistrar {
    IL2Registry public immutable registry;
    address public owner;

    // Track registered names to prevent double-registration
    mapping(bytes32 => bool) public registered;
    // One name per address
    mapping(address => bool) public hasRegistered;

    event NameRegistered(string label, address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _registry) {
        registry = IL2Registry(_registry);
        owner = msg.sender;
    }

    /// @notice Register a free subname (one per wallet, only gas cost)
    function register(string calldata label) external {
        require(!hasRegistered[msg.sender], "Already registered a name");
        require(bytes(label).length >= 3, "Label too short");
        require(bytes(label).length <= 32, "Label too long");
        require(_isValidLabel(label), "Invalid characters");

        bytes32 labelHash = keccak256(bytes(label));
        require(!registered[labelHash], "Name taken");

        registered[labelHash] = true;
        hasRegistered[msg.sender] = true;

        registry.register(label, msg.sender);

        emit NameRegistered(label, msg.sender);
    }

    /// @notice Check if a label is available
    function available(string calldata label) external view returns (bool) {
        bytes32 labelHash = keccak256(bytes(label));
        return !registered[labelHash];
    }

    /// @dev Validate label: lowercase alphanumeric + hyphens, no leading/trailing hyphens
    function _isValidLabel(string calldata label) internal pure returns (bool) {
        bytes memory b = bytes(label);
        if (b[0] == 0x2d || b[b.length - 1] == 0x2d) return false; // starts/ends with -
        for (uint i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (
                !(c >= 0x61 && c <= 0x7a) && // a-z
                !(c >= 0x30 && c <= 0x39) && // 0-9
                c != 0x2d                     // -
            ) return false;
        }
        return true;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
