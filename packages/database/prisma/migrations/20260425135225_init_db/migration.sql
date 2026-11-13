-- AlterTable
ALTER TABLE "sample_article" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "sample_item" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- CreateIndex
CREATE INDEX "sample_article_createdById_idx" ON "sample_article"("createdById");

-- CreateIndex
CREATE INDEX "sample_item_createdById_idx" ON "sample_item"("createdById");
