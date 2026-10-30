// One-time usage-key reveal. Reads the reveal row, deletes it, and shows the
// plaintext keys exactly once (only the hashes are kept on billing_items).

import Link from "next/link";
import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const TTL_MS = 15 * 60 * 1000;

export default async function KeyRevealPage({ params }: { params: Promise<{ accountId: string; nonce: string }> }) {
  const { accountId, nonce } = await params;
  const db = serviceClient();
  const { data: row } = await db.from("billing_key_reveals").select("account_id, reveals, created_at").eq("nonce", nonce).maybeSingle();

  const valid = row && row.account_id === accountId && Date.now() - new Date(row.created_at as string).getTime() < TTL_MS;
  const reveals = valid ? ((row!.reveals as { item_type: string; label: string; key: string }[]) ?? []) : [];
  // One-time: delete the row now that we've read it.
  if (row) await db.from("billing_key_reveals").delete().eq("nonce", nonce);

  return (
    <main className="px-4 py-6 md:px-8">
      <Link href={`/billing/${accountId}`} className="text-sm text-neutral-500 hover:underline">← Billing account</Link>
      <h1 className="mt-2 mb-3 text-xl font-semibold">Usage API keys</h1>
      {!valid ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          These keys have already been viewed or the link has expired. Re-issuing is a Phase-3 feature; for now, re-activate the account to mint new keys.
        </p>
      ) : (
        <>
          <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>Copy these now — they will not be shown again.</strong> Only a hash is stored. Each key authorises usage reporting for its one item.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-500"><tr><th className="py-1">Item</th><th>Usage key</th></tr></thead>
            <tbody>
              {reveals.map((r) => (
                <tr key={r.item_type} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-4">{r.label}</td>
                  <td className="py-1.5 font-mono text-xs break-all select-all">{r.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
