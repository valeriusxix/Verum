// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerumRegistry} from "../src/VerumRegistry.sol";

/// §6 test list: register/duplicate slug, only-owner, only-attester, milestone bounds, watch toggle,
/// events. Plus the 17 Nov rules: strictly increasing daily Seals, strict markMilestone, and
/// reachedAt kept only for unchanged slots.
contract VerumRegistryTest is Test {
    VerumRegistry internal registry;

    address internal admin = address(this);
    address internal attester = makeAddr("attester");
    address internal owner = makeAddr("owner");
    address internal rando = makeAddr("rando");

    address internal c1 = makeAddr("contract1");
    address internal c2 = makeAddr("contract2");

    bytes32 internal constant ORGANIC_WAU = bytes32("organic_wau");
    bytes32 internal constant TX_COUNT_30D = bytes32("tx_count_30d");

    uint64 internal constant DAY = 1 days;
    uint64 internal constant NOV_16 = 1_794_787_200; // 2026-11-16T00:00:00Z

    // events re-declared for expectEmit
    event ProjectRegistered(uint256 indexed id, address indexed owner, string slug, string metadataURI);
    event ContractsAdded(uint256 indexed id, address[] contracts);
    event MetadataUpdated(uint256 indexed id, string metadataURI);
    event MilestonesSet(uint256 indexed id, VerumRegistry.Milestone[3] milestones);
    event MilestoneReached(uint256 indexed id, uint8 indexed idx, uint256 value, uint64 at);
    event Snapshot(
        uint256 indexed id,
        uint64 indexed periodEnd,
        bytes32 metricsHash,
        uint32 organicWallets,
        uint32 rawWallets,
        uint32 txCount
    );
    event Watched(uint256 indexed id, address indexed user, bool on);
    event OwnershipTransferred(uint256 indexed id, address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        vm.warp(NOV_16 + 5 minutes); // attester cron runs 00:05 UTC
        registry = new VerumRegistry(attester);
    }

    // ------------------------------------------------------------ helpers

    function _ms(bytes32 metric, uint256 target, uint32 windowDays)
        internal
        pure
        returns (VerumRegistry.Milestone memory)
    {
        return VerumRegistry.Milestone({metric: metric, target: target, windowDays: windowDays, reachedAt: 0});
    }

    function _empty() internal pure returns (VerumRegistry.Milestone[3] memory ms) {}

    function _twoMilestones() internal pure returns (VerumRegistry.Milestone[3] memory ms) {
        ms[0] = _ms(ORGANIC_WAU, 100, 90);
        ms[1] = _ms(TX_COUNT_30D, 5_000, 90);
    }

    function _register(string memory slug) internal returns (uint256 id) {
        vm.prank(owner);
        id = registry.register(slug, "ipfs://meta");
    }

    function _registerWithMilestones() internal returns (uint256 id) {
        id = _register("verum");
        vm.prank(owner);
        registry.setMilestones(id, _twoMilestones());
    }

    function _one(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    // ------------------------------------------------------------ constructor / admin

    function test_constructor_setsAdminAndAttester() public view {
        assertEq(registry.admin(), admin);
        assertEq(registry.attester(), attester);
        assertEq(registry.projectCount(), 0);
        assertEq(registry.MAX_CONTRACTS(), 20);
    }

    function test_constructor_revertsOnZeroAttester() public {
        vm.expectRevert(VerumRegistry.ZeroAddress.selector);
        new VerumRegistry(address(0));
    }

    function test_setAttester_onlyAdmin() public {
        vm.prank(rando);
        vm.expectRevert(VerumRegistry.NotAdmin.selector);
        registry.setAttester(rando);

        registry.setAttester(rando);
        assertEq(registry.attester(), rando);

        vm.expectRevert(VerumRegistry.ZeroAddress.selector);
        registry.setAttester(address(0));
    }

    // ------------------------------------------------------------ register

    function test_register_storesProjectAndEmits() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit ProjectRegistered(1, owner, "verum", "ipfs://meta");
        uint256 id = _register("verum");

        assertEq(id, 1);
        assertEq(registry.projectCount(), 1);
        assertEq(registry.slugToId(keccak256("verum")), 1);
        (address o, string memory slug, string memory uri, uint64 createdAt) = registry.projects(1);
        assertEq(o, owner);
        assertEq(slug, "verum");
        assertEq(uri, "ipfs://meta");
        assertEq(createdAt, block.timestamp);
    }

    function test_register_idsIncrement() public {
        assertEq(_register("one"), 1);
        assertEq(_register("two"), 2);
    }

    function test_register_revertsOnDuplicateSlug() public {
        _register("verum");
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.SlugTaken.selector, "verum"));
        registry.register("verum", "");
    }

    function test_register_slugFormat() public {
        string[8] memory bad = ["ab", "Verum", "ver um", "verum_", "ver.um", "", "a-very-long-slug-that-is-over-32ch", unicode"vérum"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(VerumRegistry.BadSlug.selector);
            registry.register(bad[i], "");
        }
        // boundaries + allowed charset
        registry.register("abc", "");
        registry.register("a-b-c-0-9", "");
        registry.register("abcdefghijklmnopqrstuvwxyz012345", ""); // 32 chars
        assertEq(registry.projectCount(), 3);
    }

    function testFuzz_register_slugValidation(bytes memory raw) public {
        vm.assume(raw.length <= 40);
        bool valid = raw.length >= 3 && raw.length <= 32;
        for (uint256 i; i < raw.length && valid; ++i) {
            bytes1 ch = raw[i];
            valid = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch == "-";
        }
        if (!valid) vm.expectRevert(VerumRegistry.BadSlug.selector);
        registry.register(string(raw), "");
    }

    // ------------------------------------------------------------ registerFull

    function test_registerFull_oneTx() public {
        address[] memory cs = new address[](2);
        cs[0] = c1;
        cs[1] = c2;
        VerumRegistry.Milestone[3] memory ms = _twoMilestones();

        vm.expectEmit(true, true, false, true, address(registry));
        emit ProjectRegistered(1, owner, "verum", "ipfs://meta");
        vm.expectEmit(true, false, false, true, address(registry));
        emit ContractsAdded(1, cs);
        vm.expectEmit(true, false, false, true, address(registry));
        emit MilestonesSet(1, ms);

        vm.prank(owner);
        uint256 id = registry.registerFull("verum", "ipfs://meta", cs, ms);

        assertEq(id, 1);
        assertEq(registry.getContracts(1), cs);
        VerumRegistry.Milestone[3] memory got = registry.getMilestones(1);
        assertEq(got[0].metric, ORGANIC_WAU);
        assertEq(got[1].target, 5_000);
        assertEq(got[2].metric, bytes32(0));
    }

    function test_registerFull_emptyContractsSkipsAdd() public {
        vm.prank(owner);
        registry.registerFull("verum", "", new address[](0), _empty());
        assertEq(registry.getContracts(1).length, 0);
    }

    // ------------------------------------------------------------ only-owner

    function test_ownerFunctions_rejectNonOwner() public {
        uint256 id = _register("verum");
        vm.startPrank(rando);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.NotProjectOwner.selector, id));
        registry.addContracts(id, _one(c1));
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.NotProjectOwner.selector, id));
        registry.updateMetadata(id, "x");
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.NotProjectOwner.selector, id));
        registry.setMilestones(id, _twoMilestones());
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.NotProjectOwner.selector, id));
        registry.transferOwnership(id, rando);

        vm.stopPrank();
    }

    function test_ownerFunctions_rejectUnknownProject() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.NotProjectOwner.selector, 99));
        registry.updateMetadata(99, "x");
    }

    function test_updateMetadata_emits() public {
        uint256 id = _register("verum");
        vm.expectEmit(true, false, false, true, address(registry));
        emit MetadataUpdated(id, "ipfs://v2");
        vm.prank(owner);
        registry.updateMetadata(id, "ipfs://v2");
        (,, string memory uri,) = registry.projects(id);
        assertEq(uri, "ipfs://v2");
    }

    function test_transferOwnership() public {
        uint256 id = _register("verum");
        vm.expectEmit(true, true, true, true, address(registry));
        emit OwnershipTransferred(id, owner, rando);
        vm.prank(owner);
        registry.transferOwnership(id, rando);

        (address o,,,) = registry.projects(id);
        assertEq(o, rando);

        vm.prank(owner); // old owner lost rights
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.NotProjectOwner.selector, id));
        registry.updateMetadata(id, "x");

        vm.prank(rando);
        vm.expectRevert(VerumRegistry.ZeroAddress.selector);
        registry.transferOwnership(id, address(0));
    }

    // ------------------------------------------------------------ contracts

    function test_addContracts_maxTwenty() public {
        uint256 id = _register("verum");
        address[] memory cs = new address[](20);
        for (uint256 i; i < 20; ++i) cs[i] = address(uint160(0x1000 + i));
        vm.prank(owner);
        registry.addContracts(id, cs);
        assertEq(registry.getContracts(id).length, 20);

        vm.prank(owner);
        vm.expectRevert(VerumRegistry.TooManyContracts.selector);
        registry.addContracts(id, _one(c1));
    }

    function test_addContracts_rejectsTooManyInOneCall() public {
        uint256 id = _register("verum");
        address[] memory cs = new address[](21);
        for (uint256 i; i < 21; ++i) cs[i] = address(uint160(0x1000 + i));
        vm.prank(owner);
        vm.expectRevert(VerumRegistry.TooManyContracts.selector);
        registry.addContracts(id, cs);
    }

    function test_addContracts_rejectsDuplicatesZeroAndEmpty() public {
        uint256 id = _register("verum");
        vm.startPrank(owner);
        registry.addContracts(id, _one(c1));

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.DuplicateContract.selector, c1));
        registry.addContracts(id, _one(c1));

        address[] memory dupInCall = new address[](2);
        dupInCall[0] = c2;
        dupInCall[1] = c2;
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.DuplicateContract.selector, c2));
        registry.addContracts(id, dupInCall);

        vm.expectRevert(VerumRegistry.ZeroAddress.selector);
        registry.addContracts(id, _one(address(0)));

        vm.expectRevert(VerumRegistry.NoContracts.selector);
        registry.addContracts(id, new address[](0));
        vm.stopPrank();
    }

    // ------------------------------------------------------------ milestone bounds

    function test_setMilestones_validatesSlots() public {
        uint256 id = _register("verum");
        vm.startPrank(owner);

        VerumRegistry.Milestone[3] memory ms;
        ms[1] = _ms(ORGANIC_WAU, 0, 90); // zero target
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadMilestone.selector, 1));
        registry.setMilestones(id, ms);

        ms[1] = _ms(ORGANIC_WAU, 100, 0); // zero window
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadMilestone.selector, 1));
        registry.setMilestones(id, ms);

        ms[1] = _ms(bytes32(0), 100, 0); // unset metric with leftovers
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadMilestone.selector, 1));
        registry.setMilestones(id, ms);

        vm.stopPrank();
    }

    function test_setMilestones_ignoresCallerReachedAt() public {
        uint256 id = _register("verum");
        VerumRegistry.Milestone[3] memory ms = _twoMilestones();
        ms[0].reachedAt = 123;
        vm.prank(owner);
        registry.setMilestones(id, ms);
        assertEq(registry.getMilestones(id)[0].reachedAt, 0);
    }

    function test_setMilestones_keepsReachedAtOnlyIfUnchanged() public {
        uint256 id = _registerWithMilestones();
        vm.startPrank(attester);
        registry.markMilestone(id, 0, 150);
        registry.markMilestone(id, 1, 6_000);
        vm.stopPrank();

        VerumRegistry.Milestone[3] memory ms = _twoMilestones();
        ms[1].target = 10_000; // edit slot 1 only
        vm.prank(owner);
        registry.setMilestones(id, ms);

        VerumRegistry.Milestone[3] memory got = registry.getMilestones(id);
        assertEq(got[0].reachedAt, block.timestamp, "unchanged slot keeps reachedAt");
        assertEq(got[1].reachedAt, 0, "edited slot resets");
        assertEq(got[1].target, 10_000);
    }

    // ------------------------------------------------------------ only-attester

    function test_attesterFunctions_rejectNonAttester() public {
        uint256 id = _registerWithMilestones();
        vm.startPrank(owner);
        vm.expectRevert(VerumRegistry.NotAttester.selector);
        registry.snapshot(id, NOV_16, bytes32(0), 0, 0, 0);
        vm.expectRevert(VerumRegistry.NotAttester.selector);
        registry.markMilestone(id, 0, 1_000);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ markMilestone (strict)

    function test_markMilestone_emitsAndStores() public {
        uint256 id = _registerWithMilestones();
        vm.expectEmit(true, true, false, true, address(registry));
        emit MilestoneReached(id, 0, 100, uint64(block.timestamp));
        vm.prank(attester);
        registry.markMilestone(id, 0, 100); // exactly at target (>=)
        assertEq(registry.getMilestones(id)[0].reachedAt, block.timestamp);
    }

    function test_markMilestone_strictChecks() public {
        uint256 id = _registerWithMilestones();
        vm.startPrank(attester);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadMilestoneIndex.selector, 3));
        registry.markMilestone(id, 3, 1_000);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.MilestoneNotSet.selector, id, 2));
        registry.markMilestone(id, 2, 1_000);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.TargetNotMet.selector, 99, 100));
        registry.markMilestone(id, 0, 99);

        registry.markMilestone(id, 0, 100);
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.MilestoneAlreadyReached.selector, id, 0));
        registry.markMilestone(id, 0, 200);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.UnknownProject.selector, 99));
        registry.markMilestone(99, 0, 1);

        vm.stopPrank();
    }

    // ------------------------------------------------------------ snapshot (Seals)

    function test_snapshot_emitsAndAdvances() public {
        uint256 id = _register("verum");
        bytes32 h = keccak256("payload");
        vm.expectEmit(true, true, false, true, address(registry));
        emit Snapshot(id, NOV_16, h, 412, 1_980, 5_000);
        vm.prank(attester);
        registry.snapshot(id, NOV_16, h, 412, 1_980, 5_000);
        assertEq(registry.lastPeriodEnd(id), NOV_16);
    }

    function test_snapshot_oncePerDayStrictlyIncreasing() public {
        uint256 id = _register("verum");
        vm.startPrank(attester);
        registry.snapshot(id, NOV_16, bytes32(0), 1, 2, 3);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.StaleSnapshot.selector, NOV_16, NOV_16));
        registry.snapshot(id, NOV_16, bytes32(0), 1, 2, 3);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.StaleSnapshot.selector, NOV_16 - DAY, NOV_16));
        registry.snapshot(id, NOV_16 - DAY, bytes32(0), 1, 2, 3);

        vm.warp(NOV_16 + DAY + 5 minutes);
        registry.snapshot(id, NOV_16 + DAY, bytes32(0), 1, 2, 3);
        vm.stopPrank();
    }

    function test_snapshot_rejectsBadPeriodEnd() public {
        uint256 id = _register("verum");
        vm.startPrank(attester);
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadPeriodEnd.selector, NOV_16 + 1));
        registry.snapshot(id, NOV_16 + 1, bytes32(0), 1, 2, 3); // not midnight

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadPeriodEnd.selector, NOV_16 + DAY));
        registry.snapshot(id, NOV_16 + DAY, bytes32(0), 1, 2, 3); // future

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadPeriodEnd.selector, 0));
        registry.snapshot(id, 0, bytes32(0), 1, 2, 3);
        vm.stopPrank();
    }

    function test_snapshot_rejectsOrganicAboveRawAndUnknownProject() public {
        uint256 id = _register("verum");
        vm.startPrank(attester);
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.OrganicExceedsRaw.selector, 3, 2));
        registry.snapshot(id, NOV_16, bytes32(0), 3, 2, 3);

        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.UnknownProject.selector, 0));
        registry.snapshot(0, NOV_16, bytes32(0), 1, 2, 3);
        vm.stopPrank();
    }

    function testFuzz_snapshot_periodEndRules(uint64 periodEnd) public {
        uint256 id = _register("verum");
        bool ok = periodEnd != 0 && periodEnd % DAY == 0 && periodEnd <= block.timestamp;
        if (!ok) vm.expectRevert(abi.encodeWithSelector(VerumRegistry.BadPeriodEnd.selector, periodEnd));
        vm.prank(attester);
        registry.snapshot(id, periodEnd, bytes32(0), 0, 0, 0);
    }

    // ------------------------------------------------------------ watch toggle

    function test_watch_toggle() public {
        uint256 id = _register("verum");

        vm.expectEmit(true, true, false, true, address(registry));
        emit Watched(id, rando, true);
        vm.prank(rando);
        registry.watch(id, true);
        assertTrue(registry.watching(rando, id));

        vm.expectEmit(true, true, false, true, address(registry));
        emit Watched(id, rando, false);
        vm.prank(rando);
        registry.watch(id, false);
        assertFalse(registry.watching(rando, id));
    }

    function test_watch_rejectsUnknownProject() public {
        vm.expectRevert(abi.encodeWithSelector(VerumRegistry.UnknownProject.selector, 1));
        registry.watch(1, true);
    }

    // ------------------------------------------------------------ views

    function test_views_emptyForUnknownProject() public view {
        assertEq(registry.getContracts(1).length, 0);
        VerumRegistry.Milestone[3] memory ms = registry.getMilestones(1);
        for (uint256 i; i < 3; ++i) {
            assertEq(ms[i].metric, bytes32(0));
            assertEq(ms[i].target, 0);
        }
    }
}
