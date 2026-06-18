"use client";

// Clickable, themed loan top-up journey — the key screens from Figma board
// "Regular Loan / Top Up App" (nodes 1738:7162, 1763:7683, 1763:8283),
// rebuilt as React and recoloured to the prospect's brand. Continue/Apply
// advance the step; the screens are mockups (inputs are illustrative). This
// is the test slice — we extend to the full flow once signed off.

import { useState } from "react";

interface ScreenProps {
  brand: string;
  fg: string;
  logo: string | null;
  companyName: string;
  onNext: () => void;
  onBack?: () => void;
}

const STEPS = 3;

export function LoanJourney(props: { brand: string; fg: string; logo: string | null; companyName: string }) {
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const restart = () => setStep(0);

  const screen =
    step === 0 ? <SelectLoanScreen {...props} onNext={next} />
    : step === 1 ? <AmountScreen {...props} onNext={next} onBack={back} />
    : <SuccessScreen {...props} onNext={restart} onBack={back} />;

  return (
    <div className="flex min-h-full flex-col">
      {/* Progress bar — subtle brand-coloured step indicator. */}
      <div className="h-1 w-full bg-slate-100">
        <div className="h-full transition-all duration-300" style={{ width: `${((step + 1) / STEPS) * 100}%`, backgroundColor: props.brand }} />
      </div>
      {screen}
    </div>
  );
}

function Shell({ logo, companyName, brand, onBack, children }: { logo: string | null; companyName: string; brand: string; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pb-8 pt-7 text-slate-900">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back" className="absolute left-4 top-6 text-slate-400 hover:text-slate-700">‹</button>
      )}
      <div className="flex h-10 items-center justify-center">
        {logo ? <img src={logo} alt={companyName} className="max-h-9 max-w-[180px] object-contain" />
              : <span className="text-base font-bold" style={{ color: brand }}>{companyName}</span>}
      </div>
      <div className="mt-5 border-t border-slate-200" />
      {children}
    </div>
  );
}

function Cta({ brand, fg, label, onClick }: { brand: string; fg: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-7 w-full rounded-lg py-3 text-sm font-semibold shadow-sm" style={{ backgroundColor: brand, color: fg }}>
      {label}
    </button>
  );
}

const inputCls = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none";

function SelectLoanScreen({ brand, fg, logo, companyName, onNext }: ScreenProps) {
  return (
    <Shell logo={logo} companyName={companyName} brand={brand}>
      <h2 className="mt-6 text-[20px] font-semibold leading-7 tracking-[-0.01em]">
        You&apos;re eligible to top up an existing loan subject to an affordability assessment.
      </h2>
      <p className="mt-4 text-sm font-medium text-slate-500">Select the loan you&apos;d like to top up:</p>
      <div className="mt-3 flex items-start gap-3">
        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: brand }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: brand }} />
        </span>
        <div>
          <div className="text-[15px] font-semibold">Regular Loan</div>
          <div className="text-sm text-slate-500">Current Balance: £2,345.23</div>
        </div>
      </div>
      <Cta brand={brand} fg={fg} label="Continue" onClick={onNext} />
    </Shell>
  );
}

function AmountScreen({ brand, fg, logo, companyName, onNext, onBack }: ScreenProps) {
  return (
    <Shell logo={logo} companyName={companyName} brand={brand} onBack={onBack}>
      <h2 className="mt-6 text-[20px] font-semibold leading-7 tracking-[-0.01em]">How much more would you like to apply for?</h2>
      <input className={`${inputCls} mt-4`} placeholder="£" inputMode="numeric" />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-slate-500">Current loan balance</span>
        <span className="text-[15px] font-semibold">£2,323.42</span>
      </div>
      <p className="mt-5 text-[15px] font-semibold">Over:</p>
      <select className={inputCls} defaultValue="">
        <option value="" disabled>Please Select</option>
        <option>12 months</option><option>24 months</option><option>36 months</option><option>48 months</option>
      </select>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-slate-500">New increased loan amount</span>
        <span className="text-[15px] font-semibold">£3,000.00</span>
      </div>
      <p className="mt-5 text-[15px] font-semibold">What&apos;s this loan for?</p>
      <select className={inputCls} defaultValue="Other">
        <option>Home improvement</option><option>Car</option><option>Debt consolidation</option><option>Other</option>
      </select>
      <input className={`${inputCls} mt-2`} placeholder="Please Specify" />
      <Cta brand={brand} fg={fg} label="Apply Now" onClick={onNext} />
    </Shell>
  );
}

function SuccessScreen({ brand, fg, logo, companyName, onNext, onBack }: ScreenProps) {
  return (
    <Shell logo={logo} companyName={companyName} brand={brand} onBack={onBack}>
      <div className="mt-5 self-center rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
        Application Reference <span className="font-semibold text-slate-900">32424223</span>
      </div>
      <h2 className="mt-5 text-[20px] font-semibold leading-7 tracking-[-0.01em]">Thanks for your application</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        You&apos;ll now receive an alert confirming your application. You can chat with and share information securely with our loans team.
      </p>
      <p className="mt-5 text-[15px] font-semibold">Looking for assistance?</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">Our team is here to help — call us on <span className="font-medium text-slate-900">0161 486 1777</span>, Mon–Fri 10am–2pm.</p>
      <p className="mt-3 text-sm text-slate-600">We appreciate you choosing {companyName}.</p>
      <Cta brand={brand} fg={fg} label="Close window" onClick={onNext} />
    </Shell>
  );
}
