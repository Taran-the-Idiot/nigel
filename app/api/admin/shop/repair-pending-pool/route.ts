import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requirePermission } from "@/lib/admin-auth"
import { Permission } from "@/lib/permissions"
import { appendLedgerEntry, CurrencyTransactionType } from "@/lib/currency"
import { PENDING_BITS_ELIGIBLE_IDS } from "@/lib/shop"

/**
 * POST /api/admin/shop/repair-pending-pool
 *
 * Historically, SHOP_PURCHASE entries for pending-eligible items (in
 * PENDING_BITS_ELIGIBLE_IDS — Stasis invite, flight stipend, both
 * accommodations) drained the user's ledger but never touched the pending
 * pool, so the UI's `balance − pendingBits` ("spendable bits") display went
 * negative.
 *
 * This route simulates the patched purchase flow over each affected user's
 * ledger and inserts a net-zero corrective pair:
 *   −drain DESIGN_APPROVED   (drains pending pool)
 *   +drain SHOP_REFUND       (returns confirmed bits)
 *
 * Body: { commit?: boolean }
 *   commit !== true → dry-run report only.
 */
export async function POST(request: Request) {
  const authCheck = await requirePermission(Permission.MANAGE_CURRENCY)
  if (authCheck.error) return authCheck.error

  const body = await request.json().catch(() => ({}))
  const commit = body.commit === true

  const pendingEligible = PENDING_BITS_ELIGIBLE_IDS as readonly string[]

  const affectedUsers = await prisma.currencyTransaction.findMany({
    where: {
      type: "SHOP_PURCHASE",
      shopItemId: { in: [...pendingEligible] },
    },
    select: { userId: true },
    distinct: ["userId"],
  })

  type Report = {
    userId: string
    email: string | null
    currentPending: number
    simulatedPending: number
    drainAmount: number
    applied: boolean
    skipReason?: string
  }

  const reports: Report[] = []

  for (const { userId } of affectedUsers) {
    const [user, txs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.currencyTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { type: true, amount: true, shopItemId: true },
      }),
    ])

    let simPending = 0
    const drainStack: Record<string, number[]> = {}

    for (const tx of txs) {
      if (tx.type === "DESIGN_APPROVED") {
        simPending += tx.amount
        continue
      }
      if (!tx.shopItemId || !pendingEligible.includes(tx.shopItemId)) continue

      if (tx.type === "SHOP_PURCHASE") {
        const cost = -tx.amount
        const drain = Math.max(0, Math.min(cost, simPending))
        simPending -= drain
        ;(drainStack[tx.shopItemId] ??= []).push(drain)
      } else if (tx.type === "SHOP_REFUND") {
        const stack = drainStack[tx.shopItemId]
        const undo = stack?.pop() ?? 0
        simPending += undo
      }
    }

    const currentPendingAgg = await prisma.currencyTransaction.aggregate({
      where: { userId, type: "DESIGN_APPROVED" },
      _sum: { amount: true },
    })
    const currentPending = currentPendingAgg._sum.amount ?? 0
    const drainAmount = currentPending - simPending

    const base: Omit<Report, "applied" | "skipReason"> = {
      userId,
      email: user?.email ?? null,
      currentPending,
      simulatedPending: simPending,
      drainAmount,
    }

    if (drainAmount <= 0) {
      reports.push({ ...base, applied: false, skipReason: "no correction needed" })
      continue
    }
    if (drainAmount > currentPending) {
      reports.push({ ...base, applied: false, skipReason: "drain exceeds current pending" })
      continue
    }

    if (commit) {
      await prisma.$transaction(async (tx) => {
        await appendLedgerEntry(tx, {
          userId,
          amount: -drainAmount,
          type: CurrencyTransactionType.DESIGN_APPROVED,
          note: "Backfill: pending bits used on pending-eligible items (drained retroactively)",
          createdBy: authCheck.session.user.id,
        })
        await appendLedgerEntry(tx, {
          userId,
          amount: drainAmount,
          type: CurrencyTransactionType.SHOP_REFUND,
          note: "Backfill: confirmed bits returned — pending pool drained instead (pre-fix purchase)",
          createdBy: authCheck.session.user.id,
        })
      })
    }

    reports.push({ ...base, applied: commit })
  }

  const corrected = reports.filter((r) => r.applied)
  const skipped = reports.filter((r) => !r.applied)

  return NextResponse.json({
    commit,
    examined: reports.length,
    correctedCount: corrected.length,
    skippedCount: skipped.length,
    totalBitsDrained: corrected.reduce((acc, r) => acc + r.drainAmount, 0),
    details: reports,
  })
}
