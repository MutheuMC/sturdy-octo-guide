ALTER TABLE "Document" ADD COLUMN "previewStatus" TEXT NOT NULL DEFAULT 'NONE',
 ADD COLUMN "previewKey" TEXT, ADD COLUMN "previewSize" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "previewError" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_preview_status_check"
 CHECK ("previewStatus" IN ('NONE','QUEUED','PROCESSING','READY','FAILED'));
