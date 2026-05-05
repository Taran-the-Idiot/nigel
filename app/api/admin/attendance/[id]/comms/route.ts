import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"

/**
 * POST /api/admin/attendance/[id]/comms
 * Appends a free-form text entry to the candidate's communications log.
 * Body: { text: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error
  const { id } = await params

  const body = await request.json().catch(() => ({}))
  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) return NextResponse.json({ error: "Text required" }, { status: 400 })
  if (text.length > 5000) return NextResponse.json({ error: "Text too long" }, { status: 400 })

  const candidate = await prisma.attendanceCandidate.findUnique({ where: { id } })
  if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const entry = await prisma.attendanceCommsEntry.create({
    data: {
      candidateId: id,
      authorId: authCheck.session!.user.id,
      text,
    },
    include: {
      author: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  return NextResponse.json({ entry })
}

/**
 * DELETE /api/admin/attendance/[id]/comms?entryId=xxx
 * Deletes a single comms entry. Author or any admin may delete.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requirePermission(Permission.MANAGE_ATTENDANCE)
  if (authCheck.error) return authCheck.error
  const { id } = await params
  const entryId = request.nextUrl.searchParams.get("entryId")
  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 })

  const result = await prisma.attendanceCommsEntry.deleteMany({
    where: { id: entryId, candidateId: id },
  })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
