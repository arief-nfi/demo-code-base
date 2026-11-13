-- CreateEnum
CREATE TYPE "BillingCreditKind" AS ENUM ('GRANT', 'USE', 'RESTORE');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "includes" JSONB;

-- AlterTable
ALTER TABLE "tenant_subscription" ADD COLUMN     "grantedPlugins" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'package',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'FREE',
    "price" DECIMAL(10,2),
    "pricingCurrency" TEXT NOT NULL DEFAULT 'USD',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "pricingLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppPlugin" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "pluginKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AppPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCredit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" "BillingCreditKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceKey" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "App_key_key" ON "App"("key");

-- CreateIndex
CREATE INDEX "AppPlugin_pluginKey_idx" ON "AppPlugin"("pluginKey");

-- CreateIndex
CREATE UNIQUE INDEX "AppPlugin_appId_pluginKey_key" ON "AppPlugin"("appId", "pluginKey");

-- CreateIndex
CREATE INDEX "BillingCredit_tenantId_currency_idx" ON "BillingCredit"("tenantId", "currency");

-- CreateIndex
CREATE INDEX "BillingCredit_invoiceId_idx" ON "BillingCredit"("invoiceId");

-- AddForeignKey
ALTER TABLE "AppPlugin" ADD CONSTRAINT "AppPlugin_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
