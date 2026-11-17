// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerumRegistry
/// @notice Public traction ledger for QIE mainnet projects. Holds no funds.
/// @dev Spec: Agent.Md §6. Ownership of tracked contracts is proven OFF-chain (explorer
///      `creator_address_hash` + EIP-191), never here.
contract VerumRegistry {
    // ---------------------------------------------------------------- types

    struct Project {
        address owner;
        string slug; // unique, lowercase, 3–32 chars [a-z0-9-]
        string metadataURI; // JSON: name, track, repo, site, logo, team wallets
        uint64 createdAt;
    }

    struct Milestone {
        bytes32 metric; // plain name, UTF-8, zero right-padded (e.g. "organic_wau"); 0 = unset
        uint256 target;
        uint32 windowDays;
        uint64 reachedAt;
    }

    // ---------------------------------------------------------------- constants (§6 rules)

    uint256 public constant MAX_CONTRACTS = 20;
    uint256 public constant MIN_SLUG_LENGTH = 3;
    uint256 public constant MAX_SLUG_LENGTH = 32;
    uint256 public constant MILESTONE_SLOTS = 3;

    // ---------------------------------------------------------------- storage

    address public attester; // Verum backend key
    address public admin;
    uint256 public projectCount;
    mapping(uint256 => Project) public projects;
    mapping(bytes32 => uint256) public slugToId; // keccak(slug) => id
    mapping(uint256 => address[]) internal _contracts;
    mapping(uint256 => Milestone[3]) internal _milestones;
    mapping(address => mapping(uint256 => bool)) public watching;
    /// @notice Latest Seal per project (unix seconds, 00:00 UTC of its period_end date). Added 17 Nov 2026.
    mapping(uint256 => uint64) public lastPeriodEnd;

    // ---------------------------------------------------------------- events

    event ProjectRegistered(uint256 indexed id, address indexed owner, string slug, string metadataURI);
    event ContractsAdded(uint256 indexed id, address[] contracts);
    event MetadataUpdated(uint256 indexed id, string metadataURI);
    event MilestonesSet(uint256 indexed id, Milestone[3] milestones);
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
    /// @dev Added 17 Nov 2026 so the listener can follow per-project owner changes.
    event OwnershipTransferred(uint256 indexed id, address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------- errors

    error NotAdmin();
    error NotAttester();
    error NotProjectOwner(uint256 id);
    error UnknownProject(uint256 id);
    error BadSlug();
    error SlugTaken(string slug);
    error NoContracts();
    error TooManyContracts();
    error DuplicateContract(address contractAddress);
    error ZeroAddress();
    error BadMilestone(uint256 idx);
    error BadMilestoneIndex(uint8 idx);
    error MilestoneNotSet(uint256 id, uint8 idx);
    error MilestoneAlreadyReached(uint256 id, uint8 idx);
    error TargetNotMet(uint256 value, uint256 target);
    error BadPeriodEnd(uint64 periodEnd);
    error StaleSnapshot(uint64 periodEnd, uint64 lastPeriodEnd);
    error OrganicExceedsRaw(uint32 organicWallets, uint32 rawWallets);

    // ---------------------------------------------------------------- modifiers

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    /// @dev Unknown ids have owner == address(0), so they also fail here.
    modifier onlyProjectOwner(uint256 id) {
        if (msg.sender != projects[id].owner) revert NotProjectOwner(id);
        _;
    }

    modifier projectExists(uint256 id) {
        if (id == 0 || id > projectCount) revert UnknownProject(id);
        _;
    }

    // ---------------------------------------------------------------- constructor

    constructor(address attester_) {
        if (attester_ == address(0)) revert ZeroAddress();
        admin = msg.sender;
        attester = attester_;
    }

    // ---------------------------------------------------------------- onboarding

    /// @notice register + addContracts + setMilestones in ONE tx, so onboarding is a single
    ///         wallet signature (used by /register). An empty `contracts` array skips addContracts.
    function registerFull(
        string calldata slug,
        string calldata metadataURI,
        address[] calldata contracts,
        Milestone[3] calldata milestones
    ) external returns (uint256 id) {
        id = _register(slug, metadataURI);
        if (contracts.length != 0) _addContracts(id, contracts);
        _setMilestones(id, milestones);
    }

    // ---------------------------------------------------------------- owner functions

    /// @notice Reverts on duplicate slug or bad slug format. Ids start at 1.
    function register(string calldata slug, string calldata metadataURI) external returns (uint256 id) {
        id = _register(slug, metadataURI);
    }

    /// @notice Max 20 contracts per project; no zero address, no duplicates within a project.
    function addContracts(uint256 id, address[] calldata contracts) external onlyProjectOwner(id) {
        _addContracts(id, contracts);
    }

    function updateMetadata(uint256 id, string calldata metadataURI) external onlyProjectOwner(id) {
        projects[id].metadataURI = metadataURI;
        emit MetadataUpdated(id, metadataURI);
    }

    /// @notice Replaces all three slots. Caller-supplied `reachedAt` is ignored: a slot keeps its
    ///         reachedAt only if its metric/target/windowDays are unchanged, otherwise it resets to 0.
    function setMilestones(uint256 id, Milestone[3] calldata milestones) external onlyProjectOwner(id) {
        _setMilestones(id, milestones);
    }

    function transferOwnership(uint256 id, address newOwner) external onlyProjectOwner(id) {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(id, msg.sender, newOwner);
        projects[id].owner = newOwner;
    }

    // ---------------------------------------------------------------- attester functions

    /// @notice One Seal per project per UTC day, strictly increasing.
    ///         periodEnd = unix seconds at 00:00 UTC of the period_end date (multiple of 86400).
    ///         metricsHash = keccak256(canonical JSON of that day's daily_metrics row + cohort row).
    function snapshot(
        uint256 id,
        uint64 periodEnd,
        bytes32 metricsHash,
        uint32 organicWallets,
        uint32 rawWallets,
        uint32 txCount
    ) external onlyAttester projectExists(id) {
        if (periodEnd == 0 || periodEnd % 1 days != 0 || periodEnd > block.timestamp) {
            revert BadPeriodEnd(periodEnd);
        }
        uint64 last = lastPeriodEnd[id];
        if (periodEnd <= last) revert StaleSnapshot(periodEnd, last);
        if (organicWallets > rawWallets) revert OrganicExceedsRaw(organicWallets, rawWallets);

        lastPeriodEnd[id] = periodEnd;
        emit Snapshot(id, periodEnd, metricsHash, organicWallets, rawWallets, txCount);
    }

    /// @notice Marks a set, unreached milestone as reached. `value` must meet the target (op is `>=`).
    function markMilestone(uint256 id, uint8 idx, uint256 value) external onlyAttester projectExists(id) {
        if (idx >= MILESTONE_SLOTS) revert BadMilestoneIndex(idx);
        Milestone storage m = _milestones[id][idx];
        if (m.metric == bytes32(0)) revert MilestoneNotSet(id, idx);
        if (m.reachedAt != 0) revert MilestoneAlreadyReached(id, idx);
        if (value < m.target) revert TargetNotMet(value, m.target);

        uint64 at = uint64(block.timestamp);
        m.reachedAt = at;
        emit MilestoneReached(id, idx, value, at);
    }

    // ---------------------------------------------------------------- anyone

    /// @notice On-chain watchlist (each watch is a real user tx).
    function watch(uint256 id, bool on) external projectExists(id) {
        watching[msg.sender][id] = on;
        emit Watched(id, msg.sender, on);
    }

    // ---------------------------------------------------------------- views
    // `_contracts` and `_milestones` are internal, so the auto-generated getters can't return the
    // whole array. Added 17 Nov 2026.

    function getContracts(uint256 id) external view returns (address[] memory) {
        return _contracts[id];
    }

    function getMilestones(uint256 id) external view returns (Milestone[3] memory) {
        return _milestones[id];
    }

    // ---------------------------------------------------------------- admin

    function setAttester(address attester_) external onlyAdmin {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
    }

    // ---------------------------------------------------------------- internal

    function _register(string calldata slug, string calldata metadataURI) internal returns (uint256 id) {
        if (!_isValidSlug(bytes(slug))) revert BadSlug();
        bytes32 key = keccak256(bytes(slug));
        if (slugToId[key] != 0) revert SlugTaken(slug);

        id = ++projectCount;
        slugToId[key] = id;
        projects[id] = Project({
            owner: msg.sender,
            slug: slug,
            metadataURI: metadataURI,
            createdAt: uint64(block.timestamp)
        });
        emit ProjectRegistered(id, msg.sender, slug, metadataURI);
    }

    function _addContracts(uint256 id, address[] calldata contracts) internal {
        uint256 n = contracts.length;
        if (n == 0) revert NoContracts();
        address[] storage list = _contracts[id];
        if (list.length + n > MAX_CONTRACTS) revert TooManyContracts();

        for (uint256 i; i < n; ++i) {
            address c = contracts[i];
            if (c == address(0)) revert ZeroAddress();
            // n and list are both bounded by MAX_CONTRACTS (20), so the quadratic scan is cheap.
            uint256 len = list.length;
            for (uint256 j; j < len; ++j) {
                if (list[j] == c) revert DuplicateContract(c);
            }
            list.push(c);
        }
        emit ContractsAdded(id, contracts);
    }

    function _setMilestones(uint256 id, Milestone[3] calldata milestones) internal {
        Milestone[3] storage stored = _milestones[id];
        for (uint256 i; i < MILESTONE_SLOTS; ++i) {
            Milestone calldata next = milestones[i];
            if (next.metric == bytes32(0)) {
                // Unset slot must be fully empty.
                if (next.target != 0 || next.windowDays != 0) revert BadMilestone(i);
            } else if (next.target == 0 || next.windowDays == 0) {
                revert BadMilestone(i);
            }

            Milestone storage cur = stored[i];
            bool unchanged =
                cur.metric == next.metric && cur.target == next.target && cur.windowDays == next.windowDays;
            uint64 reachedAt = unchanged ? cur.reachedAt : 0;

            cur.metric = next.metric;
            cur.target = next.target;
            cur.windowDays = next.windowDays;
            cur.reachedAt = reachedAt;
        }
        emit MilestonesSet(id, stored);
    }

    /// @dev 3–32 chars of [a-z0-9-].
    function _isValidSlug(bytes memory s) internal pure returns (bool) {
        uint256 len = s.length;
        if (len < MIN_SLUG_LENGTH || len > MAX_SLUG_LENGTH) return false;
        for (uint256 i; i < len; ++i) {
            bytes1 ch = s[i];
            bool ok = (ch >= 0x61 && ch <= 0x7a) // a-z
                || (ch >= 0x30 && ch <= 0x39) // 0-9
                || ch == 0x2d; // -
            if (!ok) return false;
        }
        return true;
    }
}
