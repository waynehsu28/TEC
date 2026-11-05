-- Add country and transport pricing metadata without rewriting existing records or snapshots.
-- Legacy contracts and quotations remain AIR / AIRPORT / PER_KG until explicitly revised.
ALTER TABLE "ContractVersions" ADD COLUMN "transportMode" TEXT NOT NULL DEFAULT 'AIR';
ALTER TABLE "ContractVersions" ADD COLUMN "routeScope" TEXT NOT NULL DEFAULT 'AIRPORT';
ALTER TABLE "ContractVersions" ADD COLUMN "originCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ContractVersions" ADD COLUMN "destinationCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ContractVersions" ADD COLUMN "pricingBasis" TEXT NOT NULL DEFAULT 'PER_KG';
ALTER TABLE "ContractVersions" ADD COLUMN "seaShipmentType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ContractVersions" ADD COLUMN "containerType" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Quotes" ADD COLUMN "transportMode" TEXT NOT NULL DEFAULT 'AIR';
ALTER TABLE "Quotes" ADD COLUMN "routeScope" TEXT NOT NULL DEFAULT 'AIRPORT';
ALTER TABLE "Quotes" ADD COLUMN "originCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "destinationCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "pricingBasis" TEXT NOT NULL DEFAULT 'PER_KG';
ALTER TABLE "Quotes" ADD COLUMN "seaShipmentType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "containerType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quotes" ADD COLUMN "containerCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ContractVersions_transportMode_routeScope_originCountry_destinationCountry_effectiveDate_expiryDate_idx"
ON "ContractVersions"("transportMode", "routeScope", "originCountry", "destinationCountry", "effectiveDate", "expiryDate");
