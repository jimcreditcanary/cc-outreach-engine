// PUBLIC branded prospect demo (/demo/<slug>, middleware-exempt). Styled in
// the prospect's brand: left = pitch copy, right = a desktop/mobile viewport.
// Slide-like full-bleed layout. The viewport content is a branded placeholder
// until the real Figma journeys are wired in.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { DeviceFrame } from "@/components/DeviceFrame";
import { LoanJourney } from "@/components/demo/LoanJourney";

export const dynamic = "force-dynamic";

interface Demo {
  company_name: string;
  company_url: string | null;
  logo_url: string | null;
  bg_color: string | null;
  tone: string | null;
  product_type: string | null;
  description: string | null;
}

async function load(slug: string): Promise<Demo | null> {
  const { data } = await serviceClient()
    .from("demos")
    .select("company_name, company_url, logo_url, bg_color, tone, product_type, description")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Demo | null) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await load(slug);
  return { title: d ? `${d.company_name} × Credit Canary` : "Demo", robots: { index: false, follow: false } };
}

/** Pick black/white text for legibility on a brand hex (relative luminance). */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) notFound();

  const brand = d.bg_color && /^#[0-9a-f]{3,8}$/i.test(d.bg_color) ? d.bg_color : "#1f2937";
  const fg = readableOn(brand);

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col lg:flex-row">
        {/* LEFT — pitch, on a brand-tinted panel */}
        <section className="flex flex-col justify-center gap-6 px-8 py-12 lg:w-2/5" style={{ backgroundColor: brand, color: fg }}>
          <div className="flex h-12 items-center">
            {d.logo_url
              ? <img src={d.logo_url} alt={d.company_name} className="max-h-12 max-w-[220px] object-contain" />
              : <span className="text-2xl font-bold">{d.company_name}</span>}
          </div>
          <h1 className="text-3xl font-bold leading-tight">
            {d.company_name}, reimagined with Credit Canary
          </h1>
          {d.description && <p className="text-base leading-relaxed opacity-90">{d.description}</p>}
          <div className="flex flex-wrap gap-2 text-xs">
            {d.product_type && <span className="rounded-full border px-3 py-1" style={{ borderColor: fg, opacity: 0.85 }}>{d.product_type}</span>}
            {d.tone && <span className="rounded-full border px-3 py-1" style={{ borderColor: fg, opacity: 0.85 }}>{d.tone}</span>}
          </div>
          <p className="mt-auto text-xs opacity-70">A live, branded preview of your customer&apos;s origination journey — powered by Credit Canary.</p>
        </section>

        {/* RIGHT — device viewport */}
        <section className="flex flex-1 items-center justify-center bg-neutral-100 px-6 py-12">
          <DeviceFrame brand={brand}>
            <LoanJourney brand={brand} fg={fg} logo={d.logo_url} companyName={d.company_name} />
          </DeviceFrame>
        </section>
      </div>
    </main>
  );
}
