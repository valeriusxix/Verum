import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  explorerInternalTxRowSchema,
  explorerTokenTxRowSchema,
  explorerTxlistRowSchema,
} from '@verum/shared';
import {
  normalizeExternal,
  normalizeInternal,
  normalizeTokenTransfer,
  rowKey,
  selectorOf,
} from '../src/ingest/normalize';

// Real mainnet rows captured 19 Nov 2026 (inputs shortened where marked).
const QUSDC = '0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5';
const ROUTER = '0x08cd2e72e156D8563B4351eb4065C262A9f553Ef';

const creationTx = explorerTxlistRowSchema.parse({
  blockHash: '0xe43ae8b580fa2f213e311bba0c925c11a88cb80dc3dc7c4e306cf9b16722ffca',
  blockNumber: '5244996',
  confirmations: '6699020',
  contractAddress: '0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5',
  cumulativeGasUsed: '1454630',
  from: '0xe1acec6312eb701d4a14de700ccec8dee17a8d28',
  gas: '1454630',
  gasPrice: '1125000000',
  gasUsed: '1454630',
  hash: '0x847cf63ebb99609570f4d975660e93892b6adb82561059db40223b36fd810e07',
  input: '0x60806040523480156200001157600080fd5b50', // shortened init code
  isError: '0',
  nonce: '4',
  timeStamp: '1768997480',
  to: '',
  transactionIndex: '0',
  txreceipt_status: '1',
  value: '0',
});

const internalCall = explorerInternalTxRowSchema.parse({
  blockNumber: '1085044',
  callType: 'call',
  contractAddress: '',
  errCode: '',
  from: '0x08cd2e72e156d8563b4351eb4065c262a9f553ef',
  gas: '85598',
  gasUsed: '83471',
  index: '5',
  input: '0x0000000000000000000000000000000000000000000000000000000000000000', // shortened
  isError: '0',
  timeStamp: '1754285000',
  to: '0x8e23128a5511223be6c0d64106e2d4508c08398c',
  transactionHash: '0xA03C67A0D3D2B0DE7BB3F8B2CF52410EFDE939B3D6E365DBCB4ABD359E2EA703',
  type: 'call',
  value: '0',
});

const internalCreate = explorerInternalTxRowSchema.parse({
  blockNumber: '1084495',
  callType: '',
  contractAddress: '0x08cd2e72e156d8563b4351eb4065c262a9f553ef',
  errCode: '',
  from: '0x9e121d718c80f99006523b38d556f114f1a072d3',
  gas: '3588090',
  gasUsed: '3908658',
  index: '0',
  input: '',
  isError: '0',
  timeStamp: '1754284055',
  to: '',
  transactionHash: '0xa03c67a0d3d2b0de7bb3f8b2cf52410efde939b3d6e365dbcb4abd359e2ea703',
  type: 'create',
  value: '0',
});

const qusdcMint = explorerTokenTxRowSchema.parse({
  value: '500000',
  blockHash: '0xf74fbb4a646054f13555479156cc5b28a5e74796732d664832b7bfcc1ff04988',
  blockNumber: '5726371',
  confirmations: '6294132',
  contractAddress: '0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5',
  cumulativeGasUsed: '184605',
  from: '0x33a62b146026089dbca9560e33521e9e0ad7004e',
  gas: '194205',
  gasPrice: '1125000000',
  gasUsed: '184605',
  hash: '0x32e8e85622be1a958b501f2adb4ddcd19e0a531f7588a3c94fe7b9e38b4e81af',
  input: '0xa0712d68000000000000000000000000000000000000000000000000000000000007a120',
  logIndex: '2',
  nonce: '44',
  timeStamp: '1770805121',
  to: '0x3ecd3b3fa22cc251301ba78f4ba014f78b6fe542',
  tokenDecimal: '6',
  tokenName: 'QUSDC',
  tokenSymbol: 'QUSDC',
  transactionIndex: '0',
});

test('selectorOf keeps only the 4-byte selector', () => {
  assert.equal(selectorOf('0xA0712D68000000000000'), '0xa0712d68');
  assert.equal(selectorOf('0x'), '0x');
  assert.equal(selectorOf(''), '0x');
  assert.equal(selectorOf('0x1234'), '0x');
});

test('ext: contract creation', () => {
  const r = normalizeExternal(creationTx, QUSDC);
  assert.equal(r.kind, 'ext');
  assert.equal(r.log_index, -1);
  assert.equal(r.contract, QUSDC.toLowerCase());
  assert.equal(r.block, 5_244_996);
  assert.equal(r.ts.toISOString(), '2026-01-21T12:11:20.000Z');
  assert.equal(r.to_addr, null);
  assert.equal(r.selector, null); // init code is not a method call
  assert.equal(r.origin_addr, r.from_addr);
  assert.equal(r.success, true);
  assert.equal(r.gas_used, '1454630');
});

test('ext: failed tx is not a success', () => {
  assert.equal(normalizeExternal({ ...creationTx, isError: '1', txreceipt_status: '0' }, QUSDC).success, false);
  assert.equal(normalizeExternal({ ...creationTx, isError: '0', txreceipt_status: '0' }, QUSDC).success, false);
});

test('int: call keeps trace index, lowercases hash, leaves origin for RPC', () => {
  const r = normalizeInternal(internalCall, ROUTER);
  assert.equal(r.kind, 'int');
  assert.equal(r.log_index, 5);
  assert.equal(r.hash, '0xa03c67a0d3d2b0de7bb3f8b2cf52410efde939b3d6e365dbcb4abd359e2ea703');
  assert.equal(r.origin_addr, null);
  assert.equal(r.to_addr, '0x8e23128a5511223be6c0d64106e2d4508c08398c');
});

test('int: create points to_addr at the new contract', () => {
  const r = normalizeInternal(internalCreate, ROUTER);
  assert.equal(r.to_addr, ROUTER.toLowerCase());
  assert.equal(r.selector, null);
});

test('token: QUSDC transfer carries raw amount and log index', () => {
  const r = normalizeTokenTransfer(qusdcMint, '0x3ecd3b3fa22cc251301ba78f4ba014f78b6fe542');
  assert.equal(r.kind, 'token');
  assert.equal(r.log_index, 2);
  assert.equal(r.token, QUSDC.toLowerCase());
  assert.equal(r.token_amount, '500000'); // 0.5 QUSDC (6 decimals)
  assert.equal(r.value_wei, '0');
  assert.equal(r.selector, '0xa0712d68');
  assert.equal(r.origin_addr, null);
});

test('rows from the same tx in two tracked contracts have distinct keys', () => {
  const a = normalizeInternal(internalCall, ROUTER);
  const b = normalizeInternal(internalCall, '0x8E23128a5511223bE6c0d64106e2D4508C08398C');
  assert.notEqual(rowKey(a), rowKey(b));
});

test('no field is undefined (postgres.js aborts the transaction on undefined)', () => {
  for (const r of [
    normalizeExternal(creationTx, QUSDC),
    normalizeInternal(internalCall, ROUTER),
    normalizeTokenTransfer(qusdcMint, QUSDC),
  ]) {
    for (const [k, v] of Object.entries(r)) assert.notEqual(v, undefined, k);
  }
});
