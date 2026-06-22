-- Performance: index api_key_prefix — requireAuth looks agents up by the
-- 12-char prefix before bcrypt-comparing the full key. Without this index
-- every auth check is a sequential scan.
CREATE INDEX IF NOT EXISTS "Agent_api_key_prefix_idx" ON "Agent"("api_key_prefix");
