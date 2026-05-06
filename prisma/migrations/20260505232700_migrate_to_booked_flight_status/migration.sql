-- Migrate existing CONFIRMED_YES rows that were visually in the BOOKED_FLIGHT
-- column (via the old virtual-column logic) to the new BOOKED_FLIGHT enum
-- value. Preserves on-screen state across the refactor.
UPDATE "attendance_candidate"
   SET "outreachStatus" = 'BOOKED_FLIGHT'
 WHERE "outreachStatus" = 'CONFIRMED_YES'
   AND ("attendFlightBooked" = true OR "manualFlightConfirmed" = true);

-- Manual override flag is no longer needed — BOOKED_FLIGHT is its own status.
ALTER TABLE "attendance_candidate" DROP COLUMN "manualFlightConfirmed";
