-- AlterTable
ALTER TABLE "email_message" ADD COLUMN     "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "email_message_status_queuedAt_idx" ON "email_message"("status", "queuedAt");
