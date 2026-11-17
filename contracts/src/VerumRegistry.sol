// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerumRegistry
/// @notice Public traction ledger for QIE mainnet projects. Holds no funds.
/// @dev Spec: Agent.Md §6. Day 1 = scaffold (storage, events, interface). Bodies land on Day 2.
///      Ownership of tracked contracts is proven OFF-chain (explorer `creator_address_hash` + EIP-191),
///      never here.
contract VerumRegistry {
    // ---------------------------------------------------------------- types

    struct Project {
        address owner;
        string slug; // unique, lowercase, 3–32 chars [a-z0-9-]
        string metadataURI; // JSON: name, track, repo, site, logo, team wallets
        uint64 createdAt;
    }

    struct Milestone {
        bytes32 metric;
        uint256 target;
        uint32 windowDays;
        uint64 reachedAt;
    }

    // ---------------------------------------------------------------- constants (§6 rules)

    uint256 public constant MAX_CONTRACTS = 20;
    uint256 public constant MIN_SLUG_LENGTH = 3;
    uint256 public constant MAX_SLUG_LENGTH = 32;

    // ---------------------------------------------------------------- storage

    address public attester; // Verum backend key
    address public admin;
    uint256 public projectCount;
    mapping(uint256 => Project) public projects;
    mapping(bytes32 => uint256) public slugToId; // keccak(slug) => id
    mapping(uint256 => address[]) internal _contracts;
    mapping(uint256 => Milestone[3]) internal _milestones;
    mapping(address => mapping(uint256 => bool)) public watching;

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

    // ---------------------------------------------------------------- errors

    error NotAdmin();
    error NotAttester();
    error NotProjectOwner(uint256 id);
    error UnknownProject(uint256 id);
    error BadSlug();
    error SlugTaken(string slug);
    error TooManyContracts();
    error BadMilestoneIndex(uint8 idx);
    error ZeroAddress();
    error NotImplemented();

    // ---------------------------------------------------------------- modifiers

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    modifier onlyProjectOwner(uint256 id) {
        if (msg.sender != projects[id].owner) revert NotProjectOwner(id);
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
    ///         wallet signature (used by /register).
    function registerFull(
        string calldata slug,
        string calldata metadataURI,
        address[] calldata contracts,
        Milestone[3] calldata milestones
    ) external returns (uint256 id) {
        slug;
        metadataURI;
        contracts;
        milestones;
        id;
        revert NotImplemented(); // Day 2
    }

    // ---------------------------------------------------------------- owner functions

    /// @notice Reverts on duplicate slug or bad slug format.
    function register(string calldata slug, string calldata metadataURI) external returns (uint256 id) {
        slug;
        metadataURI;
        id;
        revert NotImplemented(); // Day 2
    }

    /// @notice Max 20 contracts per project.
    function addContracts(uint256 id, address[] calldata contracts) external onlyProjectOwner(id) {
        contracts;
        revert NotImplemented(); // Day 2
    }

    function updateMetadata(uint256 id, string calldata metadataURI) external onlyProjectOwner(id) {
        metadataURI;
        revert NotImplemented(); // Day 2
    }

    function setMilestones(uint256 id, Milestone[3] calldata milestones) external onlyProjectOwner(id) {
        milestones;
        revert NotImplemented(); // Day 2
    }

    function transferOwnership(uint256 id, address newOwner) external onlyProjectOwner(id) {
        newOwner;
        revert NotImplemented(); // Day 2
    }

    // ---------------------------------------------------------------- attester functions

    /// @notice Called once per project per UTC day.
    ///         metricsHash = keccak256(canonical JSON of that day's daily_metrics row + cohort row).
    function snapshot(
        uint256 id,
        uint64 periodEnd,
        bytes32 metricsHash,
        uint32 organicWallets,
        uint32 rawWallets,
        uint32 txCount
    ) external onlyAttester {
        id;
        periodEnd;
        metricsHash;
        organicWallets;
        rawWallets;
        txCount;
        revert NotImplemented(); // Day 2
    }

    function markMilestone(uint256 id, uint8 idx, uint256 value) external onlyAttester {
        id;
        idx;
        value;
        revert NotImplemented(); // Day 2
    }

    // ---------------------------------------------------------------- anyone

    /// @notice On-chain watchlist (each watch is a real user tx).
    function watch(uint256 id, bool on) external {
        id;
        on;
        revert NotImplemented(); // Day 2
    }

    // ---------------------------------------------------------------- admin

    function setAttester(address attester_) external onlyAdmin {
        attester_;
        revert NotImplemented(); // Day 2
    }
}
