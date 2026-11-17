// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VerumRegistry} from "../src/VerumRegistry.sol";

/// Deployer (= admin) is the `verum-deployer` keystore. Needs ATTESTER_ADDRESS in env.
/// Testnet first, then mainnet (§6). `--verify` verifies on Blockscout in the same run:
///   forge script script/DeployVerumRegistry.s.sol --rpc-url qie_testnet --account verum-deployer \
///     --broadcast --verify --verifier blockscout --verifier-url https://testnet.qie.digital/api/
///   forge script script/DeployVerumRegistry.s.sol --rpc-url qie --chain-id 1990 --account verum-deployer \
///     --broadcast --verify --verifier blockscout --verifier-url https://mainnet.qie.digital/api/
/// Manual verify fallback:
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
