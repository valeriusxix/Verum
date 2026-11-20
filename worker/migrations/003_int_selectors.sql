-- 20 Nov 2026: the explorer's txlistinternal `input` is NOT the internal call's calldata (verified:
-- a tx whose real top-level calldata starts 0x45fd0465 has internal rows with input 0x000000…), so
-- 13,552 int rows carried a fake selector 0x00000000. For int (and token) rows, `selector` now means
-- the selector of the TOP-LEVEL tx (what the user called to reach the project), filled by the same
-- RPC lookup that resolves origin_addr and nonce. Clear the bad values; the next sync refills them.
update txs set selector = null where kind = 'int';
