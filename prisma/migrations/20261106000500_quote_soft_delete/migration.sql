ALTER TABLE "Quotes" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "Quotes_deletedAt_createdAt_idx" ON "Quotes"("deletedAt", "createdAt");
