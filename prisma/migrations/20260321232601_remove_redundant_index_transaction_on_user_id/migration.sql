-- DropIndex (idempotent for partial applies / manual fixes)
DROP INDEX IF EXISTS "Transaction_userId_idx";
