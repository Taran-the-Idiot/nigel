import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"
import { syncCandidatesAgainstAttend, importNewAttendCandidates } from "@/lib/attend-sync"
import { getAttendPool } from "@/lib/attend-db"
import { recordSyncRun } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * POST /api/admin/attendance/sync-all
 *
 * 1. Imports any Stasis-event participants/invitations from Attend that
 *    aren't already tracked as AttendanceCandidates (idempotent).
 * 2. Refreshes cached attend* fields on every existing candidate row.
 *
 * Returns the union of both summaries so the dashboard can show "N created
 * / M updated / K bumped" in one shot.
 */
export async function POST(_request: NextRequest) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error

  if (!getAttendPool()) {
    return NextResponse.json(
      { error: "Attend integration disabled (READONLY_ATTEND_DATABASE_URL not set)" },
      { status: 503 }
    )
  }

  const importResult = await importNewAttendCandidates(prisma)
  const syncResult = await syncCandidatesAgainstAttend(prisma, { actorLabel: "manual" })

  await recordSyncRun('attend', {
    created: importResult.created,
    scanned: syncResult.scanned,
    updated: syncResult.updated,
    bumped: syncResult.bumped,
    errorCount: importResult.errors.length + syncResult.errors.length,
  }, authCheck.session?.user.id ?? null)

  return NextResponse.json({
    created: importResult.created,
    importSkipped: importResult.skippedExisting,
    attendParticipants: importResult.attendParticipants,
    attendPendingInvites: importResult.attendPendingInvites,
    scanned: syncResult.scanned,
    updated: syncResult.updated,
    bumped: syncResult.bumped,
    errors: [...importResult.errors, ...syncResult.errors],
    syncedAt: new Date().toISOString(),
  })
}
