-- Existing documents have no known edit date. Preview generation does not count as an edit.
ALTER TABLE "Document" ADD COLUMN "updatedAt" TIMESTAMP(3);
