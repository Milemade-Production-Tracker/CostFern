-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NEEDS_MATCHING', 'READY', 'REVIEWED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('PENDING', 'APPROVED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ReviewIssue" AS ENUM ('MISSING_SKU', 'DUPLICATE_SOURCE_SKU', 'MISSING_OLD', 'MISSING_NEW', 'UNMATCHED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "ReviewEventKind" AS ENUM ('IMPORTED', 'ROW_UPDATED', 'FINALIZED', 'CORRECTION_CREATED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewBatch" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "parentId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "inputFingerprint" TEXT NOT NULL,
    "oldFingerprint" TEXT NOT NULL,
    "newFingerprint" TEXT NOT NULL,
    "oldFilename" TEXT NOT NULL,
    "newFilename" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "exportFingerprint" TEXT,
    "quotaWindowKey" TEXT,

    CONSTRAINT "ReviewBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "oldCost" DECIMAL(24,4),
    "newCost" DECIMAL(24,4),
    "oldLine" INTEGER,
    "newLine" INTEGER,
    "issue" "ReviewIssue",
    "candidates" JSONB NOT NULL,
    "variantId" TEXT,
    "variantSku" TEXT,
    "variantTitle" TEXT,
    "productTitle" TEXT,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "decision" "ReviewDecision" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "ReviewEventKind" NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB NOT NULL,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewUsage" (
    "shop" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReviewUsage_pkey" PRIMARY KEY ("shop","windowKey")
);

-- CreateTable
CREATE TABLE "EntitlementAnchor" (
    "shop" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntitlementAnchor_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shop_id_key" ON "Supplier"("shop", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shop_code_key" ON "Supplier"("shop", "code");

-- CreateIndex
CREATE INDEX "ReviewBatch_shop_createdAt_idx" ON "ReviewBatch"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewBatch_shop_supplierId_finalizedAt_idx" ON "ReviewBatch"("shop", "supplierId", "finalizedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewBatch_shop_id_key" ON "ReviewBatch"("shop", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewBatch_shop_businessId_revision_key" ON "ReviewBatch"("shop", "businessId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewBatch_shop_supplierId_inputFingerprint_revision_key" ON "ReviewBatch"("shop", "supplierId", "inputFingerprint", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_shop_reviewId_position_key" ON "QuoteLine"("shop", "reviewId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_shop_reviewId_variantId_key" ON "QuoteLine"("shop", "reviewId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_shop_reviewId_version_key" ON "ReviewEvent"("shop", "reviewId", "version");

-- AddForeignKey
ALTER TABLE "ReviewBatch" ADD CONSTRAINT "ReviewBatch_shop_supplierId_fkey" FOREIGN KEY ("shop", "supplierId") REFERENCES "Supplier"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewBatch" ADD CONSTRAINT "ReviewBatch_shop_parentId_fkey" FOREIGN KEY ("shop", "parentId") REFERENCES "ReviewBatch"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_shop_reviewId_fkey" FOREIGN KEY ("shop", "reviewId") REFERENCES "ReviewBatch"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_shop_reviewId_fkey" FOREIGN KEY ("shop", "reviewId") REFERENCES "ReviewBatch"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE;

