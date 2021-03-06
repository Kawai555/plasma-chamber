pragma solidity ^0.4.24;


/**
 * @title Merkle
 * @dev Checks that a particular leaf node is in a given Merkle tree given the index, root hash, and a proof
 * based on https://github.com/omisego/plasma-mvp/blob/master/plasma/root_chain/contracts/Merkle.sol
 */
library Merkle {
    function checkMembership(bytes32 leaf, uint256 index, uint256 endIndex, bytes32 rootHash, bytes proof)
        internal
        pure
        returns (bool)
    {
        bytes32 proofElement;
        bytes32 computedHash = leaf;
        uint256 len = (proof.length / 32) * 32;

        for (uint256 i = 32; i <= len; i += 32) {
            assembly {
                proofElement := mload(add(proof, i))
            }
            if (index % 2 == 0) {
                computedHash = keccak256(computedHash, proofElement);
            } else {
                computedHash = keccak256(proofElement, computedHash);
            }
            index = index / 2;
        }
        return computedHash == rootHash;
    }
}
