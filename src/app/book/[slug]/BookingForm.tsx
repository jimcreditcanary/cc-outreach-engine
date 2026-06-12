"use client";

// Slot picker + visitor details for the public booking page. Client-side
// because slot times render in the VISITOR's timezone (we only know that
// in the browser) — slots arrive as UTC ISO strings and group/format after
// mount to avoid a server/client hydration mismatch.

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitBookingAction } from "./actions";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
    >
      {pending ? "Booking…" : disabled ? "Pick a time first" : "Confirm booking"}
    </button>
  );
}

/** Renders an ISO instant in the viewer's local timezone (after mount). */
export function LocalTime({ iso, withDate = true }: { iso: string; withDate?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const d = new Date(iso);
  if (!mounted || !isFinite(d.getTime())) return <span>…</span>;
  return (
    <span>
      {withDate && d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      {withDate && ", "}
      {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

const field = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";

export function BookingForm({ slug, slots, durationMins, embed }: { slug: string; slots: string[]; durationMins: number; embed?: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const groups = useMemo(() => {
    if (!mounted) return [] as [string, { iso: string; time: string }[]][];
    const map = new Map<string, { iso: string; time: string }[]>();
    for (const iso of slots) {
      const d = new Date(iso);
      const day = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push({ iso, time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) });
    }
    return [...map.entries()];
  }, [slots, mounted]);

  const tz = mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  return (
    <form action={submitBookingAction} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="slot" value={sel ?? ""} />
      {embed && <input type="hidden" name="embed" value="1" />}
      {/* Honeypot — hidden from humans, irresistible to bots */}
      <div className="hidden" aria-hidden="true">
        <label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-800">Pick a time</h2>
          {tz && <span className="text-xs text-neutral-400">{durationMins} min · times in {tz.replace("_", " ")}</span>}
        </div>
        {!mounted ? (
          <p className="py-6 text-center text-sm text-neutral-400">Loading times…</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 p-3">
            {groups.map(([day, times]) => (
              <div key={day}>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">{day}</div>
                <div className="flex flex-wrap gap-1.5">
                  {times.map((t) => (
                    <button
                      key={t.iso}
                      type="button"
                      onClick={() => setSel(t.iso)}
                      className={`rounded-md border px-2.5 py-1.5 text-sm tabular-nums transition-colors ${
                        sel === t.iso
                          ? "border-emerald-600 bg-emerald-600 font-semibold text-white"
                          : "border-neutral-300 bg-white text-neutral-700 hover:border-emerald-400 hover:bg-emerald-50"
                      }`}
                    >
                      {t.time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Your name *</label>
          <input name="name" required maxLength={120} className={field} placeholder="Jane Smith" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Work email *</label>
          <input name="email" type="email" required className={field} placeholder="jane@company.co.uk" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Company</label>
          <input name="company" maxLength={120} className={field} placeholder="Company name (optional)" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Anything you&apos;d like to cover?</label>
          <textarea name="note" rows={3} maxLength={2000} className={field} placeholder="Optional" />
        </div>
      </div>

      <SubmitButton disabled={!sel} />
    </form>
  );
}
