-- Deduplicate Envelope rows per (userId, name), repoint FKs to the oldest row, then enforce uniqueness.

-- Repoint dependent rows from duplicate envelopes to the keeper (earliest createdAt, then id).
UPDATE "Transaction" AS t
SET "envelopeId" = d."keeper_id"
FROM (
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY "userId", name
        ORDER BY "createdAt" ASC, id ASC
      ) AS keeper_id
    FROM "Envelope"
  )
  SELECT id AS loser_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
) AS d
WHERE t."envelopeId" = d.loser_id;

UPDATE "RecurringTransaction" AS r
SET "envelopeId" = d."keeper_id"
FROM (
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY "userId", name
        ORDER BY "createdAt" ASC, id ASC
      ) AS keeper_id
    FROM "Envelope"
  )
  SELECT id AS loser_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
) AS d
WHERE r."envelopeId" = d.loser_id;

UPDATE "PendingTransaction" AS p
SET "suggestedEnvelopeId" = d."keeper_id"
FROM (
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY "userId", name
        ORDER BY "createdAt" ASC, id ASC
      ) AS keeper_id
    FROM "Envelope"
  )
  SELECT id AS loser_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
) AS d
WHERE p."suggestedEnvelopeId" = d.loser_id;

UPDATE "TransactionShortcut" AS s
SET "envelopeId" = d."keeper_id"
FROM (
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY "userId", name
        ORDER BY "createdAt" ASC, id ASC
      ) AS keeper_id
    FROM "Envelope"
  )
  SELECT id AS loser_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
) AS d
WHERE s."envelopeId" = d.loser_id;

UPDATE "PayeeEnvelopeMapping" AS m
SET "envelopeId" = d."keeper_id"
FROM (
  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER (
        PARTITION BY "userId", name
        ORDER BY "createdAt" ASC, id ASC
      ) AS keeper_id
    FROM "Envelope"
  )
  SELECT id AS loser_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
) AS d
WHERE m."envelopeId" = d.loser_id;

-- Collapse duplicate payee mappings (same user + hash) after envelope merge.
DELETE FROM "PayeeEnvelopeMapping" AS a
USING "PayeeEnvelopeMapping" AS b
WHERE a."userId" = b."userId"
  AND a."payeeHash" = b."payeeHash"
  AND a.id > b.id;

DELETE FROM "Envelope"
WHERE id IN (
  SELECT id
  FROM (
    WITH ranked AS (
      SELECT
        id,
        FIRST_VALUE(id) OVER (
          PARTITION BY "userId", name
          ORDER BY "createdAt" ASC, id ASC
        ) AS keeper_id
      FROM "Envelope"
    )
    SELECT id FROM ranked WHERE id <> keeper_id
  ) AS losers
);

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_userId_name_key" ON "Envelope"("userId", name);
