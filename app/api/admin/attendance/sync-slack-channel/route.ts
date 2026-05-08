import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"
import { recordSyncRun } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// Confirmed-attendee channel. Pulled from
// https://app.slack.com/huddle/T0266FRGM/C0B1J3ZQ6F8
const CHANNEL_ID = "C0B1J3ZQ6F8"

const SYNC_STATUSES = ["CONFIRMED_YES", "BOOKED_FLIGHT"] as const

type InviteResult = {
  candidateId: string
  name: string | null
  slackId: string
  status: "invited" | "already_in" | "failed"
  error?: string
}

export async function POST() {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN not configured" }, { status: 500 })
  }

  const candidates = await prisma.attendanceCandidate.findMany({
    where: { outreachStatus: { in: [...SYNC_STATUSES] } },
    select: {
      id: true,
      externalName: true,
      externalSlackId: true,
      user: { select: { name: true, slackId: true } },
    },
  })

  const results: InviteResult[] = []
  let skippedNoSlackId = 0

  for (const c of candidates) {
    const slackId = c.user?.slackId ?? c.externalSlackId ?? null
    const name = c.user?.name ?? c.externalName ?? null
    if (!slackId) {
      skippedNoSlackId++
      continue
    }

    try {
      const res = await fetch("https://slack.com/api/conversations.invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: CHANNEL_ID, users: slackId }),
      })
      const data = await res.json()
      if (data.ok) {
        results.push({ candidateId: c.id, name, slackId, status: "invited" })
      } else if (data.error === "already_in_channel") {
        results.push({ candidateId: c.id, name, slackId, status: "already_in" })
      } else {
        results.push({ candidateId: c.id, name, slackId, status: "failed", error: data.error })
      }
    } catch (err) {
      results.push({ candidateId: c.id, name, slackId, status: "failed", error: String(err) })
    }
  }

  const invited = results.filter((r) => r.status === "invited").length
  const alreadyIn = results.filter((r) => r.status === "already_in").length
  const failed = results.filter((r) => r.status === "failed").length

  await recordSyncRun('slack', {
    total: candidates.length,
    invited,
    alreadyIn,
    skippedNoSlackId,
    failed,
  }, authCheck.session?.user.id ?? null)

  return NextResponse.json({
    channel: CHANNEL_ID,
    total: candidates.length,
    invited,
    alreadyIn,
    skippedNoSlackId,
    failed,
    results,
    syncedAt: new Date().toISOString(),
  })
}
