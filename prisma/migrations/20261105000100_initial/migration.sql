-- CreateTable
CREATE TABLE "Customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "defaultCurrency" TEXT NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractVersions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "airline" TEXT NOT NULL DEFAULT '',
    "serviceType" TEXT NOT NULL DEFAULT '',
    "commodity" TEXT NOT NULL DEFAULT '',
    "effectiveDate" TEXT NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "minimumCharge" TEXT NOT NULL DEFAULT '',
    "normalRate" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractVersions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contracts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractRateBreaks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    CONSTRAINT "ContractRateBreaks_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractCharges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "minimumAmount" TEXT NOT NULL DEFAULT '',
    "manualAmount" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ContractCharges_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quotes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "customerId" TEXT NOT NULL,
    "contractVersionId" TEXT,
    "status" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quotes_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quotes_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteCargoItems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "length" TEXT NOT NULL,
    "width" TEXT NOT NULL,
    "height" TEXT NOT NULL,
    "grossWeight" TEXT NOT NULL,
    "weightMode" TEXT NOT NULL,
    CONSTRAINT "QuoteCargoItems_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteCharges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL,
    "originalRate" TEXT NOT NULL,
    "appliedRate" TEXT NOT NULL,
    "originalAmount" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "temporary" BOOLEAN NOT NULL,
    CONSTRAINT "QuoteCharges_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteCostItems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" TEXT,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "QuoteCostItems_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteRevisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "previousQuoteId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteRevisions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuoteRevisions_previousQuoteId_fkey" FOREIGN KEY ("previousQuoteId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "companyName" TEXT NOT NULL DEFAULT '',
    "companyLogo" TEXT NOT NULL DEFAULT '',
    "volumeDivisor" TEXT NOT NULL DEFAULT '6000',
    "weightIncrement" TEXT NOT NULL DEFAULT '0.5',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" TEXT NOT NULL DEFAULT '',
    "exchangeRateDate" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "ExchangeRates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT,
    "usdToTwd" TEXT NOT NULL,
    "rateDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRates_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteCounter" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "sequence" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "Customers_code_key" ON "Customers"("code");

-- CreateIndex
CREATE INDEX "Customers_status_name_idx" ON "Customers"("status", "name");

-- CreateIndex
CREATE INDEX "Contracts_customerId_status_idx" ON "Contracts"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Contracts_customerId_number_routeKey_key" ON "Contracts"("customerId", "number", "routeKey");

-- CreateIndex
CREATE INDEX "ContractVersions_origin_destination_effectiveDate_expiryDate_idx" ON "ContractVersions"("origin", "destination", "effectiveDate", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersions_contractId_version_key" ON "ContractVersions"("contractId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ContractRateBreaks_versionId_weight_key" ON "ContractRateBreaks"("versionId", "weight");

-- CreateIndex
CREATE INDEX "ContractCharges_versionId_idx" ON "ContractCharges"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotes_number_key" ON "Quotes"("number");

-- CreateIndex
CREATE INDEX "Quotes_customerId_createdAt_idx" ON "Quotes"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Quotes_rootId_revision_idx" ON "Quotes"("rootId", "revision");

-- CreateIndex
CREATE INDEX "Quotes_status_createdAt_idx" ON "Quotes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QuoteCargoItems_quoteId_idx" ON "QuoteCargoItems"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteCharges_quoteId_idx" ON "QuoteCharges"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteCostItems_quoteId_idx" ON "QuoteCostItems"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRevisions_quoteId_revision_key" ON "QuoteRevisions"("quoteId", "revision");

-- CreateIndex
CREATE INDEX "ExchangeRates_quoteId_rateDate_idx" ON "ExchangeRates"("quoteId", "rateDate");
