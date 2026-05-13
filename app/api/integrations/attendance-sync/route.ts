import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { syncCandidatesAgainstAttend, importNewAttendCandidates } from "@/lib/attend-sync"
import { getAttendPool } from "@/lib/attend-db"
import { recordSyncRun } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// Bearer-authenticated mirror of /api/admin/attendance/sync-all for external
// schedulers (Coolify cron). Same import + refresh, but tagged actorLabel:"cron"
// so the dashboard "last sync" indicator and audit log can distinguish
// automated runs from manual button presses.
export async function POST(request: NextRequest) {
  const authError = requireIntegrationAuth(request)
  if (authError) return authError

  if (!getAttendPool()) {
    return NextResponse.json(
      { error: "Attend integration disabled (READONLY_ATTEND_DATABASE_URL not set)" },
      { status: 503 }
    )
  }

  const importResult = await importNewAttendCandidates(prisma)
  const syncResult = await syncCandidatesAgainstAttend(prisma, { actorLabel: "cron" })

  await recordSyncRun('attend', {
    created: importResult.created,
    scanned: syncResult.scanned,
    updated: syncResult.updated,
    bumped: syncResult.bumped,
    errorCount: importResult.errors.length + syncResult.errors.length,
  }, null)

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
