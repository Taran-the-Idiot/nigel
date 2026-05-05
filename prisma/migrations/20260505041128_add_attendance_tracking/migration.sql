-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('IDENTIFIED', 'CONTACTED', 'SOFT_YES', 'CONFIRMED_YES', 'DECLINED');

-- CreateTable
CREATE TABLE "attendance_candidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "externalName" TEXT,
    "externalEmail" TEXT,
    "externalSlackId" TEXT,
    "externalImage" TEXT,
    "outreachStatus" "AttendanceStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "ownerId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "notes" TEXT,
    "flakeNote" TEXT,
    "attendInvited" BOOLEAN NOT NULL DEFAULT false,
    "attendFlightBooked" BOOLEAN NOT NULL DEFAULT false,
    "attendCachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "attendance_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_comms_entry" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_comms_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_audit_entry" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "actorId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_reminder" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_candidate_userId_key" ON "attendance_candidate"("userId");

-- CreateIndex
CREATE INDEX "attendance_candidate_outreachStatus_idx" ON "attendance_candidate"("outreachStatus");

-- CreateIndex
CREATE INDEX "attendance_candidate_ownerId_idx" ON "attendance_candidate"("ownerId");

-- CreateIndex
CREATE INDEX "attendance_candidate_snoozedUntil_idx" ON "attendance_candidate"("snoozedUntil");

-- CreateIndex
CREATE INDEX "attendance_comms_entry_candidateId_createdAt_idx" ON "attendance_comms_entry"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_audit_entry_candidateId_createdAt_idx" ON "attendance_audit_entry"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_reminder_candidateId_idx" ON "attendance_reminder"("candidateId");

-- CreateIndex
CREATE INDEX "attendance_reminder_dueAt_idx" ON "attendance_reminder"("dueAt");

-- AddForeignKey
ALTER TABLE "attendance_candidate" ADD CONSTRAINT "attendance_candidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_candidate" ADD CONSTRAINT "attendance_candidate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_candidate" ADD CONSTRAINT "attendance_candidate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_comms_entry" ADD CONSTRAINT "attendance_comms_entry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "attendance_candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_comms_entry" ADD CONSTRAINT "attendance_comms_entry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_audit_entry" ADD CONSTRAINT "attendance_audit_entry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "attendance_candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_audit_entry" ADD CONSTRAINT "attendance_audit_entry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_reminder" ADD CONSTRAINT "attendance_reminder_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "attendance_candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_reminder" ADD CONSTRAINT "attendance_reminder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
