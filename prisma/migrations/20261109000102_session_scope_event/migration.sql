ALTER TABLE "Session" ADD COLUMN "scopeUpdatedAt" TIMESTAMP(3);

CREATE INDEX "Session_shop_createdAt_idx" ON "Session"("shop", "createdAt");
