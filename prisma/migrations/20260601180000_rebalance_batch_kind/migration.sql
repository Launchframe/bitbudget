-- Idempotent: align legacy move_funds batch/recurring kinds with rebalance vocabulary.
UPDATE "EnvelopeFundingBatch"
SET kind = 'rebalance'
WHERE kind = 'move_funds';

UPDATE "RecurringFundingRule"
SET kind = 'rebalance'
WHERE kind = 'move_funds';
