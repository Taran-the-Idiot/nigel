-- CreateTable
CREATE TABLE "sync_run_log" (
    "id" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "result" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_run_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_run_log_syncKey_createdAt_idx" ON "sync_run_log"("syncKey", "createdAt");

-- AddForeignKey
ALTER TABLE "sync_run_log" ADD CONSTRAINT "sync_run_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
