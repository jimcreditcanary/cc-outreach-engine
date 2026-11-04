// Address lookup via Allies Postcoder. Powers postcode → address autocomplete
// on the merchant form (UBO residential + trading addresses). DESCOPED until a
// key is set: with no POSTCODER_API_KEY the lookup returns no suggestions (it
// does NOT fabricate addresses) — the form still accepts manually-typed
// addresses, so nothing fake is ever saved as a real address.
//
// Env (live): POSTCODER_API_KEY.

export interface PostalAddress {
  summaryline: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  postcode: string;
}

export interface PostcoderClient {
  /** Addresses at a postcode (empty on no match / error). */
  lookup(postcode: string): Promise<PostalAddress[]>;
}

const BASE = "https://ws.postcoder.com/pcw";

function liveClient(key: string): PostcoderClient {
  return {
    async lookup(postcode) {
      const pc = postcode.trim();
      if (!pc) return [];
      try {
        const res = await fetch(`${BASE}/${encodeURIComponent(key)}/address/uk/${encodeURIComponent(pc)}?format=json&lines=2`);
        if (!res.ok) return [];
        const items = (await res.json()) as Record<string, string>[];
        return (items ?? []).map((a) => ({
          summaryline: a.summaryline ?? [a.addressline1, a.addressline2, a.posttown, a.postcode].filter(Boolean).join(", "),
          line1: a.addressline1 ?? "",
          line2: a.addressline2 ?? "",
          city: a.posttown ?? "",
          county: a.county ?? "",
          postcode: a.postcode ?? pc,
        }));
      } catch {
        return [];
      }
    },
  };
}

export function getPostcoder(): PostcoderClient {
  // Descoped until keyed: no fabricated suggestions — just no autocomplete.
  const key = process.env.POSTCODER_API_KEY;
  return key ? liveClient(key) : { async lookup() { return []; } };
}
