import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"

/**
 * GET /api/admin/attendance/lookup?q=foo
 * Searches Stasis users by email/name/slack for the "add candidate" flow.
 * Returns up to 10 matches with whether they already have an attendance row.
 */
export async function GET(request: NextRequest) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim()
  if (q.length < 2) return NextResponse.json({ items: [] })

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { slackId: { contains: q, mode: "insensitive" } },
        { slackDisplayName: { contains: q, mode: "insensitive" } },
      ],
      fraudConvicted: false,
    },
    take: 10,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, name: true, image: true, slackId: true,
      attendanceCandidate: { select: { id: true } },
    },
  })

  return NextResponse.json({
    items: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      slackId: u.slackId,
      existingCandidateId: u.attendanceCandidate?.id ?? null,
    })),
  })
}
