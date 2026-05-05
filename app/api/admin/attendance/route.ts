import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"
import { sanitize } from "@/lib/sanitize"
import { AttendanceStatus, CurrencyTransactionType } from "@/app/generated/prisma/enums"

/**
 * GET /api/admin/attendance
 * Returns the full curated attendance list (denormalized for the dashboard).
 * Includes a per-row effort summary computed from the currency ledger.
 */
export async function GET() {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error

  const candidates = await prisma.attendanceCandidate.findMany({
    orderBy: [{ outreachStatus: "asc" }, { updatedAt: "desc" }],
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          slackId: true,
          pronouns: true,
          eventPreference: true,
        },
      },
      owner: { select: { id: true, name: true, email: true, image: true } },
      _count: { select: { commsEntries: true, reminders: true } },
    },
  })

  // Resolve "real bits" + project counts + last-touch in batch.
  const userIds = candidates.map((c) => c.userId).filter((u): u is string => !!u)

  const [bits, projectCounts, lastComms] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : prisma.currencyTransaction.groupBy({
          by: ["userId"],
          where: {
            userId: { in: userIds },
            type: { in: [CurrencyTransactionType.PROJECT_APPROVED, CurrencyTransactionType.DESIGN_APPROVED, CurrencyTransactionType.PROJECT_APPROVED_REVERSED, CurrencyTransactionType.DESIGN_APPROVED_REVERSED] },
          },
          _sum: { amount: true },
        }),
    userIds.length === 0
      ? Promise.resolve([])
      : prisma.project.groupBy({
          by: ["userId"],
          where: { userId: { in: userIds }, deletedAt: null },
          _count: true,
        }),
    prisma.attendanceCommsEntry.findMany({
      where: { candidateId: { in: candidates.map((c) => c.id) } },
      orderBy: { createdAt: "desc" },
      distinct: ["candidateId"],
      select: { candidateId: true, createdAt: true, text: true, authorId: true },
    }),
  ])

  const bitsByUser = new Map(bits.map((b) => [b.userId, b._sum.amount ?? 0]))
  const projectCountByUser = new Map(projectCounts.map((p) => [p.userId, p._count]))
  const lastCommsByCandidate = new Map(lastComms.map((c) => [c.candidateId, c]))

  const items = candidates.map((c) => {
    const realBits = c.userId ? bitsByUser.get(c.userId) ?? 0 : 0
    const projectCount = c.userId ? projectCountByUser.get(c.userId) ?? 0 : 0
    const last = lastCommsByCandidate.get(c.id) ?? null
    return {
      id: c.id,
      userId: c.userId,
      // identity (pulled from user when linked, else external fields)
      name: c.user?.name ?? c.externalName ?? null,
      email: c.user?.email ?? c.externalEmail ?? null,
      slackId: c.user?.slackId ?? c.externalSlackId ?? null,
      image: c.user?.image ?? c.externalImage ?? null,
      pronouns: c.user?.pronouns ?? null,
      eventPreference: c.user?.eventPreference ?? null,
      // pipeline
      outreachStatus: c.outreachStatus,
      ownerId: c.ownerId,
      owner: c.owner,
      snoozedUntil: c.snoozedUntil,
      // attend
      attendInvited: c.attendInvited,
      attendFlightBooked: c.attendFlightBooked,
      attendCachedAt: c.attendCachedAt,
      // effort
      realBits,
      projectCount,
      // notes / comms summary
      flakeNote: c.flakeNote,
      hasNotes: !!c.notes && c.notes.trim().length > 0,
      commsCount: c._count.commsEntries,
      remindersCount: c._count.reminders,
      lastComms: last
        ? {
            createdAt: last.createdAt,
            text: last.text.slice(0, 140),
            authorId: last.authorId,
          }
        : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }
  })

  return NextResponse.json({ items })
}

/**
 * POST /api/admin/attendance
 * Create a new candidate. Either:
 *   { userId }                                   – link to existing Stasis user
 *   { externalName, externalEmail?, externalSlackId? } – external candidate
 */
export async function POST(request: NextRequest) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === "string" ? body.userId : null
  const externalName = typeof body.externalName === "string" ? sanitize(body.externalName).slice(0, 200) : null
  const externalEmail = typeof body.externalEmail === "string" ? sanitize(body.externalEmail).slice(0, 200).toLowerCase() : null
  const externalSlackId = typeof body.externalSlackId === "string" ? sanitize(body.externalSlackId).slice(0, 50) : null

  if (!userId && !externalName) {
    return NextResponse.json({ error: "Must supply userId or externalName" }, { status: 400 })
  }

  if (userId) {
    const existing = await prisma.attendanceCandidate.findUnique({ where: { userId } })
    if (existing) {
      return NextResponse.json({ error: "Candidate already exists for this user", candidateId: existing.id }, { status: 409 })
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
  }

  const candidate = await prisma.attendanceCandidate.create({
    data: {
      userId,
      externalName: userId ? null : externalName,
      externalEmail: userId ? null : externalEmail,
      externalSlackId: userId ? null : externalSlackId,
      createdById: authCheck.session!.user.id,
      outreachStatus: AttendanceStatus.IDENTIFIED,
    },
  })

  return NextResponse.json({ id: candidate.id })
}
