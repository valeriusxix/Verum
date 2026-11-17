// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerumRegistry} from "../src/VerumRegistry.sol";

/// Day 1: deployment smoke test only.
/// Day 2 (§6): register/duplicate slug, only-owner, only-attester, milestone bounds, watch toggle, events.
contract VerumRegistryTest is Test {
    VerumRegistry internal registry;
    address internal attester = makeAddr("attester");

    function setUp() public {
        registry = new VerumRegistry(attester);
    }

    function test_constructor_setsAdminAndAttester() public view {
        assertEq(registry.admin(), address(this));
        assertEq(registry.attester(), attester);
        assertEq(registry.projectCount(), 0);
        assertEq(registry.MAX_CONTRACTS(), 20);
    }

    function test_constructor_revertsOnZeroAttester() public {
        vm.expectRevert(VerumRegistry.ZeroAddress.selector);
        new VerumRegistry(address(0));
    }

    function test_views_emptyForUnknownProject() public view {
        assertEq(registry.getContracts(1).length, 0);
        VerumRegistry.Milestone[3] memory ms = registry.getMilestones(1);
        for (uint256 i; i < 3; ++i) {
            assertEq(ms[i].metric, bytes32(0));
            assertEq(ms[i].target, 0);
        }
    }

    function test_attesterFunctions_rejectNonAttester() public {
        vm.expectRevert(VerumRegistry.NotAttester.selector);
        registry.snapshot(1, 0, bytes32(0), 0, 0, 0);
        vm.expectRevert(VerumRegistry.NotAttester.selector);
        registry.markMilestone(1, 0, 0);
    }

    function test_adminFunctions_rejectNonAdmin() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(VerumRegistry.NotAdmin.selector);
        registry.setAttester(address(1));
    }
}
