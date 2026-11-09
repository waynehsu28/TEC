ALTER TABLE "Quotes" ADD COLUMN "customerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "customerCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "origin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "destination" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "analysisCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Quotes" ADD COLUMN "validity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "revenue" TEXT;
ALTER TABLE "Quotes" ADD COLUMN "grossProfit" TEXT;
ALTER TABLE "Quotes" ADD COLUMN "provisional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quotes" ADD COLUMN "quantity" TEXT;
ALTER TABLE "Quotes" ADD COLUMN "unit" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "appliedBreak" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "chargeableWeight" TEXT;
ALTER TABLE "Quotes" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "searchVersion" INTEGER NOT NULL DEFAULT 0;

-- Build a small immutable projection once, without reserializing historical snapshots.
UPDATE "Quotes" SET
  "customerName" = COALESCE(json_extract("snapshot", '$.customer.name'), (SELECT "name" FROM "Customers" WHERE "Customers"."id" = "Quotes"."customerId"), ''),
  "customerCode" = COALESCE(json_extract("snapshot", '$.customer.code'), (SELECT "code" FROM "Customers" WHERE "Customers"."id" = "Quotes"."customerId"), ''),
  "origin" = COALESCE(json_extract("snapshot", '$.input.origin'), ''),
  "destination" = COALESCE(json_extract("snapshot", '$.input.destination'), ''),
  "analysisCurrency" = CASE WHEN json_extract("snapshot", '$.input.analysisCurrency') = 'TWD' THEN 'TWD' ELSE 'USD' END,
  "validity" = COALESCE(json_extract("snapshot", '$.input.validity'), ''),
  "revenue" = CAST(json_extract("snapshot", '$.finance.revenue') AS TEXT),
  "grossProfit" = CAST(json_extract("snapshot", '$.finance.grossProfit') AS TEXT),
  "provisional" = COALESCE(json_extract("snapshot", '$.finance.provisional'), false),
  "quantity" = COALESCE(CAST(json_extract("snapshot", '$.freight.quantity') AS TEXT), CASE WHEN json_extract("snapshot", '$.freight.appliedBreak') != 'MANUAL' THEN CAST(json_extract("snapshot", '$.weights.chargeableWeight') AS TEXT) END),
  "unit" = COALESCE(json_extract("snapshot", '$.freight.unit'), CASE WHEN json_extract("snapshot", '$.freight.appliedBreak') != 'MANUAL' AND json_extract("snapshot", '$.weights.chargeableWeight') IS NOT NULL THEN 'KG' ELSE '' END),
  "appliedBreak" = COALESCE(json_extract("snapshot", '$.freight.appliedBreak'), ''),
  "chargeableWeight" = CAST(json_extract("snapshot", '$.weights.chargeableWeight') AS TEXT)
WHERE json_valid("snapshot");

UPDATE "Quotes" SET "searchText" = replace(lower("number" || ' ' || "customerName" || ' ' || "customerCode" || ' ' || "origin" || ' ' || "destination" || ' ' || "originCountry" || ' ' || "destinationCountry" || CASE WHEN "routeScope" = 'COUNTRY' THEN ' 全國適用' ELSE '' END), '臺', '台');

CREATE INDEX "Quotes_deletedAt_createdAt_id_idx" ON "Quotes"("deletedAt", "createdAt", "id");
CREATE INDEX "Quotes_deletedAt_customerId_createdAt_id_idx" ON "Quotes"("deletedAt", "customerId", "createdAt", "id");
CREATE INDEX "Quotes_deletedAt_transportMode_status_createdAt_id_idx" ON "Quotes"("deletedAt", "transportMode", "status", "createdAt", "id");
CREATE INDEX "Quotes_searchVersion_id_idx" ON "Quotes"("searchVersion", "id");
