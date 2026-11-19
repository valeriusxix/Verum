/**
 * VerumRegistry deployments. Source of truth for worker/api/web defaults; env `REGISTRY_ADDRESS`
 * overrides. Every value was read back from chain + explorer after deploy.
 */
import type { Address, Hash } from 'viem';
import type { QieNetwork } from './chains';

export interface RegistryDeployment {
  readonly address: Address;
  readonly deployTx: Hash;
  /** First block to scan for registry events. */
  readonly deployBlock: number;
  readonly admin: Address;
  readonly attester: Address;
}

export const REGISTRY_DEPLOYMENTS: Readonly<Partial<Record<QieNetwork, RegistryDeployment>>> = {
  // Day 2, 19 Nov 2026. Verified on testnet.qie.digital (solc 0.8.24, shanghai, 200 runs).
  testnet: {
    address: '0xF5B151fCcf3C4b79345643f634f29A584d461390',
    deployTx: '0x8c079c96923fe1cabf39f47a4705c4be9a44c649905ec8f55044c987b4f7c0c0',
    deployBlock: 9_862_511,
    admin: '0x7bb1c5aaB342892829e7d845bF094CA4a3a12465',
    attester: '0xcA2088DdEF3d868e56905957600950a840FeCCC0',
  },
  // mainnet: Day 9 (24 Nov).
};
