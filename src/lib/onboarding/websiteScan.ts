// Best-effort discovery of a company's privacy-policy URL from its website
// (merchant form item 8 — prefill the privacy-policy field from a website scan).
// Fetches the homepage and looks for a link that points at a privacy page.
// Advisory: the customer can always override. Never throws.

function withScheme(url: string): string {
  const s = url.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
}

export async function discoverPrivacyPolicyUrl(website: string): Promise<string | null> {
  const base = withScheme(website);
  if (!base) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(base, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "CreditCanaryOnboarding/1.0 (+https://creditcanary.co.uk)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 500_000);
    // Prefer an anchor whose href or visible text mentions "privacy".
    const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    let hrefOnly: string | null = null;
    while ((m = anchorRe.exec(html))) {
      const href = m[1]!;
      const text = m[2]!.replace(/<[^>]+>/g, " ");
      if (/privacy/i.test(text)) return abs(href, base);
      if (!hrefOnly && /privacy/i.test(href)) hrefOnly = href;
    }
    return hrefOnly ? abs(hrefOnly, base) : null;
  } catch {
    return null;
  }
}

function abs(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
