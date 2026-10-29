// Lead invite chase job. Sends the 48h and 7-day follow-ups to leads who were
// invited but haven't booked a call or opted for sandbox access. Booking is
// detected from the `meetings` table (Jim's HubSpot meetings link books into his
// calendar, which syncs here) — any meeting with the lead's email as an attendee
// dated after the invite counts. Run daily from Vercel Cron.

import type { serviceClient } from "../db/client";
import { sendTransactional } from "../send/postmark";
import { buildInviteEmail, inviteEnabled, type InviteStage } from "./invite";

type DB = ReturnType<typeof serviceClient>;

const HOUR = 60 * 60 * 1000;

interface Attendee {
  name?: string | null;
  address?: string | null;
}

/** True when a meeting exists with `email` as an attendee, dated at/after
 *  `sinceIso` (booked after we invited them). */
export async function hasBookedSince(db: DB, email: string, sinceIso: string): Promise<boolean> {
  const target = email.trim().toLowerCase();
  const { data } = await db
    .from("meetings")
    .select("attendees")
    .or(`start_at.gte.${sinceIso},created_at.gte.${sinceIso}`)
    .limit(1000);
  for (const row of (data ?? []) as { attendees: Attendee[] | null }[]) {
    for (const a of row.attendees ?? []) {
      if ((a.address ?? "").trim().toLowerCase() === target) return true;
    }
  }
  return false;
}

interface ChaseRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  owner_id: string | null;
  asset: string | null;
  token: string;
  invited_at: string;
  chase_48h_at: string | null;
  chase_7d_at: string | null;
}

export interface ChaseResult { considered: number; booked: number; chased48h: number; chased7d: number; expired: number; disabled?: boolean }

export async function runLeadChases(db: DB): Promise<ChaseResult> {
  const res: ChaseResult = { considered: 0, booked: 0, chased48h: 0, chased7d: 0, expired: 0 };
  if (!inviteEnabled()) return { ...res, disabled: true };

  const { data } = await db
    .from("lead_call_invites")
    .select("id, email, name, company, owner_id, asset, token, invited_at, chase_48h_at, chase_7d_at")
    .eq("status", "active")
    .not("invited_at", "is", null)
    .limit(500);
  const rows = (data ?? []) as ChaseRow[];
  res.considered = rows.length;
  const now = Date.now();

  for (const row of rows) {
    try {
      const invitedMs = new Date(row.invited_at).getTime();
      const ageH = (now - invitedMs) / HOUR;
      if (ageH < 48) continue; // nothing due yet

      // Stop the sequence if they've since booked.
      if (await hasBookedSince(db, row.email, row.invited_at)) {
        await db.from("lead_call_invites").update({ status: "booked", booked_at: new Date().toISOString() }).eq("id", row.id);
        res.booked++;
        continue;
      }

      if (ageH >= 168 && !row.chase_7d_at) {
        await sendChase(db, "chase_7d", row);
        await db.from("lead_call_invites").update({ chase_7d_at: new Date().toISOString(), status: "expired" }).eq("id", row.id);
        res.chased7d++;
        res.expired++;
      } else if (ageH >= 48 && !row.chase_48h_at) {
        await sendChase(db, "chase_48h", row);
        await db.from("lead_call_invites").update({ chase_48h_at: new Date().toISOString() }).eq("id", row.id);
        res.chased48h++;
      }
    } catch (e) {
      console.error("lead chase:", row.id, (e as Error)?.message);
    }
  }
  return res;
}

async function sendChase(db: DB, stage: Extract<InviteStage, "chase_48h" | "chase_7d">, row: ChaseRow): Promise<void> {
  const firstName = (row.name ?? "").trim().split(/\s+/)[0] || row.email.split("@")[0] || "there";
  const { subject, textBody, htmlBody } = buildInviteEmail(stage, {
    firstName,
    company: row.company,
    asset: row.asset,
    token: row.token,
  });
  await sendTransactional({ to: row.email, subject, textBody, htmlBody, ownerId: row.owner_id, tag: `lead-${stage.replace("_", "-")}` });
}
