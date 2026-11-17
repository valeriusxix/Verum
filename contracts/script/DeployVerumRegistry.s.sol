// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VerumRegistry} from "../src/VerumRegistry.sol";

/// Testnet first, then mainnet (§6):
///   forge script script/DeployVerumRegistry.s.sol --rpc-url qie_testnet --account <keystore> --broadcast
///   forge script script/DeployVerumRegistry.s.sol --rpc-url qie --chain-id 1990 --account <keystore> --broadcast
/// Verify (mainnet):
///   forge verify-contract <addr> src/VerumRegistry.sol:VerumRegistry --chain-id 1990 \
///     --verifier blockscout --verifier-url https://mainnet.qie.digital/api/ \
///     --constructor-args $(cast abi-encode "constructor(address)" $ATTESTER_ADDRESS)
contract DeployVerumRegistry is Script {
    function run() external returns (VerumRegistry registry) {
        address attester = vm.envAddress("ATTESTER_ADDRESS");
        vm.startBroadcast();
        registry = new VerumRegistry(attester);
        vm.stopBroadcast();
        console2.log("VerumRegistry", address(registry));
        console2.log("admin", registry.admin());
        console2.log("attester", registry.attester());
    }
}
