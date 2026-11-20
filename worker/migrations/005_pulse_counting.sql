-- 20 Nov 2026: the explorer's /api/v2/stats `transactions_today` is NOT today's count. It equals the
-- previous complete UTC day (1,772 = the tx chart's value for 2026-11-19, while an RPC count of
-- today's blocks to 19:27 UTC gave 1,638). The worker now counts today's txs itself, block by
-- block over RPC, incrementally: each pulse stores the last block it counted.
alter table chain_pulse add column day_start_block bigint;  -- first block of `day` (00:00 UTC)
alter table chain_pulse add column last_block bigint;       -- txs_today covers day_start_block..last_block
-- The one row written before this fix used the explorer's figure: wrong, remove it.
delete from chain_pulse where last_block is null;
