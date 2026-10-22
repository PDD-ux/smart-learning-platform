-- Additive and lazy: no existing content, notes, references or exam records are rewritten.
ALTER TABLE "LearningContent" ADD COLUMN "bookState" JSONB;
ALTER TABLE "LearningContent" ADD COLUMN "bookRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LearningContent" ADD CONSTRAINT "book_revision_nonnegative" CHECK ("bookRevision" >= 0);
