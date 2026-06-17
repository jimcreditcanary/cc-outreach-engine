"use client";

// "Generate Demo Link" wizard (button lives in the /companies header).
// Flow: enter URL + name → Retrieve branding (Claude profiles the site) →
// review/override logo, colour, tone, product, copy → commit → shows the
// public /demo/<slug> link. Steps are client-side; the two server actions
// do the profiling and the save.

import { useState } from "react";
import { retrieveBrandingAction, createDemoAction } from "@/app/companies/demo-actions";
import { PRODUCT_TYPES, type Branding } from "@/lib/demos/types";

type Step = "form" | "review" | "done";

const field = "w-full rounded border border-neutral-300 px-3 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500";

export function DemoWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [b, setB] = useState<Branding | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);

  function reset() {
    setStep("form"); setBusy(false); setError(null);
    setUrl(""); setName(""); setB(null); setLogo(null); setSlug(null);
  }
  function close() { setOpen(false); reset(); }

  async function retrieve() {
    setBusy(true); setError(null);
    const res = await retrieveBrandingAction(url, name);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setB(res.branding);
    setLogo(res.branding.logo_url);
    if (!name) setName(res.branding ? (name || url) : name);
    setStep("review");
  }

  async function commit() {
    if (!b) return;
    setBusy(true); setError(null);
    const res = await createDemoAction({
      company_name: name || url,
      company_url: b.company_url,
      logo_url: logo,
      bg_color: b.bg_color,
      tone: b.tone,
      product_type: b.product_type,
      description: b.description,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setSlug(res.slug);
    setStep("done");
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 600_000) { setError("Logo too large — please use an image under 600KB."); return; }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(f);
  }

  const demoUrl = slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/demo/${slug}` : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-900"
      >
        ✨ Generate Demo Link
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <h2 className="font-semibold text-neutral-800">
                {step === "form" && "Generate a demo link"}
                {step === "review" && "Review the branding"}
                {step === "done" && "Demo link ready"}
              </h2>
              <button onClick={close} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">✕</button>
            </div>

            <div className="space-y-4 p-5">
              {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

              {step === "form" && (
                <>
                  <p className="text-sm text-neutral-500">We&apos;ll profile the prospect&apos;s website to brand the demo. You can tweak everything before it goes live.</p>
                  <div>
                    <label className={lbl}>Company website</label>
                    <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="acmelending.co.uk" className={field} autoFocus />
                  </div>
                  <div>
                    <label className={lbl}>Company name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Lending" className={field} />
                  </div>
                  <button
                    type="button"
                    disabled={busy || !url.trim()}
                    onClick={retrieve}
                    className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-neutral-300"
                  >
                    {busy ? "Profiling the site…" : "Retrieve branding"}
                  </button>
                </>
              )}

              {step === "review" && b && (
                <>
                  {/* Logo — shown object-contain in a fixed frame so any warp is
                      obvious; upload a clean replacement if needed. */}
                  <div>
                    <label className={lbl}>Logo</label>
                    <div className="flex items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3" style={{ minHeight: 80 }}>
                      {logo
                        ? <img src={logo} alt="logo" className="max-h-16 max-w-[16rem] object-contain" />
                        : <span className="text-xs text-neutral-400">No logo found — upload one</span>}
                    </div>
                    {b.logo_candidates.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {b.logo_candidates.map((c) => (
                          <button key={c} type="button" onClick={() => setLogo(c)} className={`rounded border p-1 ${logo === c ? "border-emerald-500" : "border-neutral-200"}`}>
                            <img src={c} alt="" className="h-8 w-16 object-contain" />
                          </button>
                        ))}
                      </div>
                    )}
                    <label className="mt-2 inline-block cursor-pointer text-xs font-medium text-blue-700 hover:underline">
                      Upload a replacement (PNG/SVG, &lt;600KB)
                      <input type="file" accept="image/*" onChange={onUpload} className="hidden" />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Background colour</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={/^#[0-9a-f]{6}$/i.test(b.bg_color) ? b.bg_color : "#1f2937"} onChange={(e) => setB({ ...b, bg_color: e.target.value })} className="h-9 w-12 rounded border border-neutral-300" />
                        <input value={b.bg_color} onChange={(e) => setB({ ...b, bg_color: e.target.value })} className={field} />
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Product type</label>
                      <select value={b.product_type} onChange={(e) => setB({ ...b, product_type: e.target.value as Branding["product_type"] })} className={field}>
                        {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className={lbl}>Tone of voice</label>
                    <input value={b.tone} onChange={(e) => setB({ ...b, tone: e.target.value })} className={field} />
                  </div>
                  <div>
                    <label className={lbl}>Description (left of the landing page)</label>
                    <textarea value={b.description} onChange={(e) => setB({ ...b, description: e.target.value })} rows={3} className={field} />
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => setStep("form")} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100">Back</button>
                    <button type="button" disabled={busy} onClick={commit} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-neutral-300">
                      {busy ? "Saving…" : "Commit & create link"}
                    </button>
                  </div>
                </>
              )}

              {step === "done" && slug && (
                <>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <div className="mb-1 text-2xl">🔗</div>
                    <p className="text-sm font-medium text-emerald-900">Your branded demo is live</p>
                    <a href={demoUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-emerald-800 underline">{demoUrl}</a>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => navigator.clipboard?.writeText(demoUrl)} className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100">Copy link</button>
                    <a href={demoUrl} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-700">Open demo</a>
                  </div>
                  <button type="button" onClick={reset} className="w-full text-xs text-neutral-500 hover:underline">Generate another</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
