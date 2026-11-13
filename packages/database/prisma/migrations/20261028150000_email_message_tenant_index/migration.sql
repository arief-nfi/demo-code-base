-- A workspace log reads the platform emails sent for it from public
CREATE INDEX "email_message_tenantSlug_createdAt_idx" ON "email_message"("tenantSlug", "createdAt");
