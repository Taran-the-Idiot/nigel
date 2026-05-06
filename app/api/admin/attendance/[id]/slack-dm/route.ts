import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"
import { sendUserDM, isSlackError, type UserDMTokens } from "@/lib/slack-user-dm"

/**
 * POST /api/admin/attendance/[id]/slack-dm
 *
 * Send a Slack DM (as the admin whose tokens are in the body, via xoxc/xoxd)
 * to a candidate, then log the verbatim message and — if they were in the
 * sourcing pool — promote them to "Reached out".
 *
 * Body:
 *   {
 *     xoxcToken:  string             // Slack xoxc-... token of the sending admin
 *     xoxdToken:  string             // matching xoxd-... cookie value
 *     instance?:  string             // override Slack workspace host (default hackclub.enterprise.slack.com)
 *     message:    string             // Slack mrkdwn body
 *     ownerId?:   string | null      // optional — set/clear candidate.ownerId. Omit to leave untouched.
 *     requirePool?: boolean          // optional — when true, reject if not currently IDENTIFIED
 *     dryRun?:    boolean            // if true, validate + return preview, don't send
 *   }
 *
 * Side effects (only when not dryRun and the DM succeeds):
 *   - candidate.outreachStatus := CONTACTED         (only if currently IDENTIFIED)
 *   - candidate.invitedAt      := now               (only if currently null)
 *   - candidate.ownerId        := body.ownerId      (only if `ownerId` key present in body)
 *   - AttendanceCommsEntry created (verbatim text, author = session admin)
 *   - AttendanceAuditEntry rows for any field that actually changed
 *
 * Notes:
 *   - The DM author is determined by the xoxc/xoxd tokens, not the session.
 *     The session admin is just the comms-entry author + audit actor (the
 *     person who triggered the script).
 *   - Owner is NOT auto-set. Pass `ownerId` explicitly when you want to assign.
 *     This lets one admin script DMs on behalf of multiple owners (e.g. me
 *     running a batch where each row already has its intended owner).
 *   - By default the pool gate is OFF — you can re-DM someone in CONTACTED+
 *     to send a follow-up. Pass `requirePool: true` for first-touch scripts
 *     that should hard-fail if anyone in the batch was already contacted.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error
  const { id } = await params
  const actorId = authCheck.session!.user.id

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const xoxcToken = typeof body.xoxcToken === "string" ? body.xoxcToken.trim() : ""
  const xoxdToken = typeof body.xoxdToken === "string" ? body.xoxdToken.trim() : ""
  const instance = typeof body.instance === "string" && body.instance.trim() ? body.instance.trim() : undefined
  const message = typeof body.message === "string" ? body.message : ""
  const dryRun = body.dryRun === true
  const requirePool = body.requirePool === true

  // Distinguish "ownerId not provided" (don't touch) from "ownerId: null"
  // (clear it) and "ownerId: 'xyz'" (set to xyz). Hence the `in` check.
  const ownerIdProvided = "ownerId" in body
  const ownerIdRaw = ownerIdProvided ? body.ownerId : undefined
  let ownerIdNew: string | null | undefined = undefined  // undefined = no change
  if (ownerIdProvided) {
    if (ownerIdRaw === null) {
      ownerIdNew = null
    } else if (typeof ownerIdRaw === "string" && ownerIdRaw.length > 0) {
      ownerIdNew = ownerIdRaw
    } else {
      return NextResponse.json({ error: "ownerId must be a string or null", code: "bad_owner_id" }, { status: 400 })
    }
  }

  if (!xoxcToken || !xoxcToken.startsWith("xoxc-")) {
    return NextResponse.json({ error: "xoxcToken required (must start with xoxc-)", code: "bad_xoxc" }, { status: 400 })
  }
  if (!xoxdToken) {
    return NextResponse.json({ error: "xoxdToken required", code: "bad_xoxd" }, { status: 400 })
  }
  if (!message.trim()) {
    return NextResponse.json({ error: "message required", code: "empty_message" }, { status: 400 })
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: "message too long (max 5000 chars)", code: "message_too_long" }, { status: 400 })
  }

  const candidate = await prisma.attendanceCandidate.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, slackId: true, name: true, email: true } },
    },
  })
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found", code: "not_found" }, { status: 404 })
  }

  if (requirePool && candidate.outreachStatus !== "IDENTIFIED") {
    return NextResponse.json(
      {
        error: `requirePool=true but candidate is not in the sourcing pool (current: ${candidate.outreachStatus})`,
        code: "not_in_pool",
        currentStatus: candidate.outreachStatus,
      },
      { status: 409 }
    )
  }

  // Validate ownerId points at a real ATTENDANCE_ADMIN (or ADMIN with the
  // permission). Cheap query, prevents silently writing a bad user id.
  if (ownerIdNew !== undefined && ownerIdNew !== null) {
    const owner = await prisma.user.findUnique({
      where: { id: ownerIdNew },
      select: { id: true, roles: { select: { role: true } } },
    })
    if (!owner) {
      return NextResponse.json({ error: "ownerId user not found", code: "owner_not_found" }, { status: 400 })
    }
    const roleNames = owner.roles.map((r) => r.role)
    if (!roleNames.includes("ATTENDANCE_ADMIN") && !roleNames.includes("ADMIN")) {
      return NextResponse.json(
        { error: "ownerId user is not an attendance admin", code: "owner_not_admin" },
        { status: 400 }
      )
    }
  }

  const slackId = candidate.user?.slackId ?? candidate.externalSlackId ?? null
  if (!slackId) {
    return NextResponse.json(
      { error: "Candidate has no Slack ID — can't DM", code: "no_slack_id" },
      { status: 400 }
    )
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      target: {
        slackId,
        name: candidate.user?.name ?? candidate.externalName ?? null,
        email: candidate.user?.email ?? candidate.externalEmail ?? null,
        currentStatus: candidate.outreachStatus,
      },
      willChange: {
        outreachStatus: candidate.outreachStatus === "IDENTIFIED" ? "CONTACTED" : null,
        invitedAt: candidate.invitedAt ? null : "now",
        ownerId: ownerIdNew !== undefined ? ownerIdNew : null,
      },
      preview: { message, length: message.length },
    })
  }

  const tokens: UserDMTokens = { xoxc: xoxcToken, xoxd: xoxdToken, instance }

  let dmResult: { ts: string; channelId: string; alreadyOpen: boolean }
  try {
    dmResult = await sendUserDM(tokens, slackId, message)
  } catch (e: unknown) {
    if (isSlackError(e)) {
      return NextResponse.json(
        { error: `Slack API error: ${e.error}`, code: "slack_error", slackError: e.error, slackStatus: e.status },
        { status: 502 }
      )
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), code: "send_failed" },
      { status: 502 }
    )
  }

  // Decide what's actually changing on the candidate. Audit only fields that
  // move; leave the rest alone so re-DMs don't pollute the audit log.
  const now = new Date()
  const data: Record<string, unknown> = {}
  const audit: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

  if (candidate.outreachStatus === "IDENTIFIED") {
    data.outreachStatus = "CONTACTED"
    audit.push({ field: "outreachStatus", oldValue: "IDENTIFIED", newValue: "CONTACTED" })
  }
  if (!candidate.invitedAt) {
    data.invitedAt = now
    audit.push({ field: "invitedAt", oldValue: null, newValue: now.toISOString() })
  }
  if (ownerIdNew !== undefined && ownerIdNew !== candidate.ownerId) {
    data.ownerId = ownerIdNew
    audit.push({ field: "ownerId", oldValue: candidate.ownerId, newValue: ownerIdNew })
  }

  // DM is already out — DB failures leave us inconsistent. Wrap the writes in
  // one transaction so comms entry + status update + audit succeed together.
  const { commsEntry } = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.attendanceCandidate.update({ where: { id }, data })
    }
    const entry = await tx.attendanceCommsEntry.create({
      data: {
        candidateId: id,
        authorId: actorId,
        text: message,
      },
    })
    if (audit.length > 0) {
      await tx.attendanceAuditEntry.createMany({
        data: audit.map((a) => ({
          candidateId: id,
          actorId,
          field: a.field,
          oldValue: a.oldValue,
          newValue: a.newValue,
        })),
      })
    }
    return { commsEntry: entry }
  })

  return NextResponse.json({
    ok: true,
    slack: { ts: dmResult.ts, channelId: dmResult.channelId, alreadyOpen: dmResult.alreadyOpen },
    candidate: {
      id,
      outreachStatus: data.outreachStatus ?? candidate.outreachStatus,
      ownerId: ownerIdNew !== undefined ? ownerIdNew : candidate.ownerId,
      invitedAt: (data.invitedAt ?? candidate.invitedAt ?? null),
    },
    commsEntryId: commsEntry.id,
    changedFields: audit.map((a) => a.field),
  })
}
