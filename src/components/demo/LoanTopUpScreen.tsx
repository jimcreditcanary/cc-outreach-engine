// Figma node 1738:7162 ("/direct/about" — loan top-up) rebuilt as a themed
// React screen. The source's brand token (`black`, used for the CTA + radio)
// maps to the prospect's brand colour; heading/body keep slate neutrals so
// only the genuinely-branded bits recolour. Same journey, their branding.

export function LoanTopUpScreen({
  brand,
  fg,
  logo,
  companyName,
}: {
  brand: string;
  fg: string; // readable text colour on `brand`
  logo: string | null;
  companyName: string;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col px-6 pb-8 pt-7 text-slate-900">
      {/* Logo + divider */}
      <div className="flex h-10 items-center justify-center">
        {logo ? (
          <img src={logo} alt={companyName} className="max-h-9 max-w-[180px] object-contain" />
        ) : (
          <span className="text-base font-bold" style={{ color: brand }}>{companyName}</span>
        )}
      </div>
      <div className="mt-5 border-t border-slate-200" />

      {/* Heading */}
      <h2 className="mt-6 text-[20px] font-semibold leading-7 tracking-[-0.01em]">
        You&apos;re eligible to top up an existing loan subject to an affordability assessment.
      </h2>

      <p className="mt-4 text-sm font-medium text-slate-500">Select the loan you&apos;d like to top up:</p>

      {/* Loan option (selected) */}
      <div className="mt-3 flex items-start gap-3">
        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: brand }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: brand }} />
        </span>
        <div>
          <div className="text-[15px] font-semibold">Regular Loan</div>
          <div className="text-sm text-slate-500">Current Balance: £2,345.23</div>
        </div>
      </div>

      {/* CTA */}
      <button
        type="button"
        className="mt-7 w-full rounded-lg py-3 text-sm font-semibold shadow-sm"
        style={{ backgroundColor: brand, color: fg }}
      >
        Continue
      </button>
    </div>
  );
}
