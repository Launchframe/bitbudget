-- Unique index on code / userId already covers equality lookups; drop redundant non-unique indexes.
DROP INDEX IF EXISTS "ReferralCode_code_idx";
DROP INDEX IF EXISTS "Survey_userId_idx";
