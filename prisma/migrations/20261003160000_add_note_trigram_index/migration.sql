-- pg_trgm provides indexed substring matching for CJK note text without
-- requiring a server-wide Chinese text-search parser such as zhparser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Note_content_trgm_idx"
ON "Note"
USING GIN ("content" gin_trgm_ops);
