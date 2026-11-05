CREATE TABLE "ContractChargeRateBreaks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chargeId" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    CONSTRAINT "ContractChargeRateBreaks_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "ContractCharges" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContractChargeRateBreaks_chargeId_weight_key" ON "ContractChargeRateBreaks"("chargeId", "weight");

ALTER TABLE "QuoteCharges" ADD COLUMN "appliedBreak" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuoteCharges" ADD COLUMN "quantity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuoteCharges" ADD COLUMN "minimumApplied" BOOLEAN NOT NULL DEFAULT false;
