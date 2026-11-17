# contracts

Foundry project for `VerumRegistry.sol` (spec: `Agent.Md` §6). Small, auditable, holds no funds.

```sh
forge build
forge test
```

- `src/VerumRegistry.sol`: registry (projects, contracts, milestones, Seals, watchlist)
- `test/VerumRegistry.t.sol`: tests
- `script/DeployVerumRegistry.s.sol`: deploy (needs `ATTESTER_ADDRESS` in env)

`evm_version = "shanghai"`: QIE has no Cancun opcodes. See `foundry.toml`.
