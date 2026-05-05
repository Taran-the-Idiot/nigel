import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"
import { sanitize } from "@/lib/sanitize"
import { AttendanceStatus, CurrencyTransactionType } from "@/app/generated/prisma/enums"
import { lookupAttendByEmail } from "@/lib/attend-db"

/**
 * GET /api/admin/attendance/[id]
 * Returns the full denormalized profile for one candidate, with all sub-panels:
 * stasis projects, bits ledger summary, attend status, comms log, notes,
 * audit log, reminders.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error
  const { id } = await params

  const candidate = await prisma.attendanceCandidate.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          slackId: true,
          slackDisplayName: true,
          pronouns: true,
          eventPreference: true,
          attendRegisteredAt: true,
          createdAt: true,
        },
      },
      owner: { select: { id: true, name: true, email: true, image: true } },
      commsEntries: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true, email: true, image: true } } },
      },
      auditEntries: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { id: true, name: true, email: true, image: true } } },
      },
      reminders: {
        where: { resolvedAt: null },
        orderBy: { dueAt: "asc" },
        include: { createdBy: { select: { id: true, name: true } } },
      },
    },
  })

  if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Stasis-side data (only if linked to a user)
  let stasis: {
    projects: Array<{
      id: string
      title: string
      tier: number | null
      designStatus: string
      buildStatus: string
      hoursClaimed: number
      bitsAwarded: number | null
      createdAt: Date
    }>
    realBits: number
    adminGrants: number
    deductions: number
    shopSpend: number
    totalHoursClaimed: number
  } | null = null

  if (candidate.userId) {
    const [projects, ledgerByType] = await Promise.all([
      prisma.project.findMany({
        where: { userId: candidate.userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, title: true, tier: true, designStatus: true, buildStatus: true,
          bitsAwarded: true, createdAt: true,
          workSessions: { select: { hoursClaimed: true } },
        },
      }),
      prisma.currencyTransaction.groupBy({
        by: ["type"],
        where: { userId: candidate.userId },
        _sum: { amount: true },
      }),
    ])

    const sumByType = new Map<string, number>(
      ledgerByType.map((l) => [l.type, l._sum.amount ?? 0])
    )
    const realBits =
      (sumByType.get(CurrencyTransactionType.PROJECT_APPROVED) ?? 0) +
      (sumByType.get(CurrencyTransactionType.DESIGN_APPROVED) ?? 0) +
      (sumByType.get(CurrencyTransactionType.PROJECT_APPROVED_REVERSED) ?? 0) +
      (sumByType.get(CurrencyTransactionType.DESIGN_APPROVED_REVERSED) ?? 0)

    stasis = {
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        tier: p.tier,
        designStatus: p.designStatus,
        buildStatus: p.buildStatus,
        hoursClaimed: p.workSessions.reduce((s, w) => s + (w.hoursClaimed < 200 ? w.hoursClaimed : 0), 0),
        bitsAwarded: p.bitsAwarded,
        createdAt: p.createdAt,
      })),
      realBits,
      adminGrants: sumByType.get(CurrencyTransactionType.ADMIN_GRANT) ?? 0,
      deductions: Math.abs(sumByType.get(CurrencyTransactionType.ADMIN_DEDUCTION) ?? 0),
      shopSpend: Math.abs(sumByType.get(CurrencyTransactionType.SHOP_PURCHASE) ?? 0),
      totalHoursClaimed: projects.reduce(
        (s, p) => s + p.workSessions.reduce((ss, w) => ss + (w.hoursClaimed < 200 ? w.hoursClaimed : 0), 0),
        0
      ),
    }
  }

  // Live Attend lookup (synchronous; cheap because we're hitting one row)
  const email = candidate.user?.email ?? candidate.externalEmail ?? null
  const attend = email ? await lookupAttendByEmail(email).catch(() => null) : null

  return NextResponse.json({
    candidate: {
      id: candidate.id,
      userId: candidate.userId,
      name: candidate.user?.name ?? candidate.externalName ?? null,
      email: candidate.user?.email ?? candidate.externalEmail ?? null,
      slackId: candidate.user?.slackId ?? candidate.externalSlackId ?? null,
      slackDisplayName: candidate.user?.slackDisplayName ?? null,
      image: candidate.user?.image ?? candidate.externalImage ?? null,
      pronouns: candidate.user?.pronouns ?? null,
      eventPreference: candidate.user?.eventPreference ?? null,
      outreachStatus: candidate.outreachStatus,
      ownerId: candidate.ownerId,
      owner: candidate.owner,
      snoozedUntil: candidate.snoozedUntil,
      notes: candidate.notes,
      flakeNote: candidate.flakeNote,
      attendInvited: candidate.attendInvited,
      attendFlightBooked: candidate.attendFlightBooked,
      attendCachedAt: candidate.attendCachedAt,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      isExternal: !candidate.userId,
    },
    stasis,
    attend,
    commsEntries: candidate.commsEntries,
    auditEntries: candidate.auditEntries,
    reminders: candidate.reminders,
  })
}

/**
 * PATCH /api/admin/attendance/[id]
 * Updates a subset of fields and writes audit entries for any changes.
 * Updatable: outreachStatus, ownerId, snoozedUntil, notes, flakeNote,
 *            externalName, externalEmail, externalSlackId, externalImage.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const existing = await prisma.attendanceCandidate.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Record<string, unknown> = {}
  const audit: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

  function maybeSet<T>(
    field: string,
    nextRaw: unknown,
    oldVal: T | null,
    parse: (v: unknown) => T | null,
    serialize: (v: T | null) => string | null
  ) {
    if (nextRaw === undefined) return
    const next = parse(nextRaw)
    if (next === oldVal) return
    if (next === null && oldVal === null) return
    if (next != null && oldVal != null && serialize(next) === serialize(oldVal)) return
    data[field] = next
    audit.push({ field, oldValue: serialize(oldVal), newValue: serialize(next) })
  }

  maybeSet(
    "outreachStatus",
    body.outreachStatus,
    existing.outreachStatus,
    (v) => (typeof v === "string" && v in AttendanceStatus ? (v as AttendanceStatus) : null),
    (v) => v
  )
  maybeSet(
    "ownerId",
    body.ownerId,
    existing.ownerId,
    (v) => (typeof v === "string" && v.length > 0 ? v : v === null ? null : null),
    (v) => v
  )
  maybeSet(
    "snoozedUntil",
    body.snoozedUntil,
    existing.snoozedUntil,
    (v) => {
      if (v === null) return null
      if (typeof v !== "string") return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d
    },
    (v) => (v ? v.toISOString() : null)
  )
  maybeSet(
    "notes",
    body.notes,
    existing.notes,
    (v) => (typeof v === "string" ? v.slice(0, 50_000) : v === null ? null : null),
    (v) => (v ? v.slice(0, 200) : null)
  )
  maybeSet(
    "flakeNote",
    body.flakeNote,
    existing.flakeNote,
    (v) => (typeof v === "string" ? sanitize(v).slice(0, 1000) : v === null ? null : null),
    (v) => v
  )

  // External-only edits
  if (!existing.userId) {
    maybeSet("externalName", body.externalName, existing.externalName,
      (v) => (typeof v === "string" ? sanitize(v).slice(0, 200) : null), (v) => v)
    maybeSet("externalEmail", body.externalEmail, existing.externalEmail,
      (v) => (typeof v === "string" ? sanitize(v).slice(0, 200).toLowerCase() : null), (v) => v)
    maybeSet("externalSlackId", body.externalSlackId, existing.externalSlackId,
      (v) => (typeof v === "string" ? sanitize(v).slice(0, 50) : null), (v) => v)
    maybeSet("externalImage", body.externalImage, existing.externalImage,
      (v) => (typeof v === "string" ? sanitize(v).slice(0, 500) : null), (v) => v)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true })
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendanceCandidate.update({ where: { id }, data })
    if (audit.length > 0) {
      await tx.attendanceAuditEntry.createMany({
        data: audit.map((a) => ({
          candidateId: id,
          actorId: authCheck.session!.user.id,
          field: a.field,
          oldValue: a.oldValue,
          newValue: a.newValue,
        })),
      })
    }
  })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/admin/attendance/[id]
 * Removes the candidate (cascades comms, audit, reminders). Use sparingly.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error
  const { id } = await params
  await prisma.attendanceCandidate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
