import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface HotSend {
  id: string;
  subject: string | null;
  clicked: boolean;
  replied: boolean;
  ts: string;
  contact: { full_name: string | null; email: string | null; organisation: { name: string | null; sector: string | null; tier: number | null } | null } | null;
}

export default async function HotPage() {
  const db = serviceClient();
  const { data } = await db
    .from("sends")
    .select("id, subject, clicked, replied, ts, contact:contacts(full_name, email, organisation:organisations(name, sector, tier))")
    .or("clicked.eq.true,replied.eq.true")
    .order("ts", { ascending: false })
    .limit(100);
  const hot = (data ?? []) as unknown as HotSend[];

  return (
    <main className="w-full px-[50px] py-8">
      <header className="mb-6 border-b border-neutral-200 pb-3">
        <h1 className="text-xl font-semibold">Hot flags</h1>
        <p className="text-sm text-neutral-500">
          Engaged contacts — clicked or replied. A T3 who engages is a promotion candidate: curate a proposal and they become T1.
        </p>
      </header>

      {hot.length === 0 ? (
        <p className="text-neutral-500">No engagement yet (clicks/replies appear here once sending is live).</p>
      ) : (
        <ul className="space-y-2">
          {hot.map((h) => (
            <li key={h.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{h.contact?.full_name}</span>
                <span className="text-neutral-500">{h.contact?.organisation?.name}</span>
                {h.clicked && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">clicked</span>}
                {h.replied && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">replied</span>}
                {h.contact?.organisation?.tier === 3 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">promote → T1?</span>
                )}
              </div>
              <div className="mt-1 text-neutral-600">{h.subject}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
