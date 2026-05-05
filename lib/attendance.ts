import { AttendanceStatus } from "@/app/generated/prisma/enums"
import { CurrencyTransactionType } from "@/app/generated/prisma/enums"

export { AttendanceStatus }

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  IDENTIFIED: "Identified",
  CONTACTED: "Contacted",
  SOFT_YES: "Soft yes",
  CONFIRMED_YES: "Confirmed yes",
  DECLINED: "Declined",
}

// Order in which kanban columns appear (left → right).
// "Booked flight" is a derived 6th column shown for candidates whose
// CONFIRMED_YES + Attend says they have an inbound flight.
export const KANBAN_COLUMNS = [
  "IDENTIFIED",
  "CONTACTED",
  "SOFT_YES",
  "CONFIRMED_YES",
  "BOOKED_FLIGHT",
  "DECLINED",
] as const
export type KanbanColumn = (typeof KANBAN_COLUMNS)[number]

export const KANBAN_COLUMN_LABELS: Record<KanbanColumn, string> = {
  IDENTIFIED: "Identified",
  CONTACTED: "Contacted",
  SOFT_YES: "Soft yes",
  CONFIRMED_YES: "Confirmed yes",
  BOOKED_FLIGHT: "Booked flight",
  DECLINED: "Declined",
}

/**
 * Currency transaction types that count as "real" effort (project shipping
 * vs admin grants or reviewer pay). Used to compute the effort signal.
 */
export const REAL_EFFORT_BIT_TYPES: CurrencyTransactionType[] = [
  CurrencyTransactionType.PROJECT_APPROVED,
  CurrencyTransactionType.PROJECT_APPROVED_REVERSED,
  CurrencyTransactionType.DESIGN_APPROVED,
  CurrencyTransactionType.DESIGN_APPROVED_REVERSED,
]

/** Color hint for status pills in the UI. */
export function statusTone(status: AttendanceStatus | null): string {
  switch (status) {
    case "DECLINED":     return "text-red-500"
    case "CONFIRMED_YES":return "text-green-500"
    case "SOFT_YES":     return "text-yellow-500"
    case "CONTACTED":    return "text-orange-500"
    case "IDENTIFIED":   return "text-cream-200"
    default:             return "text-cream-200"
  }
}

/** Compute the kanban column for a candidate. */
export function kanbanColumnFor(
  outreach: AttendanceStatus,
  attendFlightBooked: boolean
): KanbanColumn {
  if (outreach === "DECLINED") return "DECLINED"
  if (attendFlightBooked && outreach === "CONFIRMED_YES") return "BOOKED_FLIGHT"
  return outreach as KanbanColumn
}
