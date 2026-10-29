// Address lookup via Allies Postcoder. Powers postcode → address autocomplete
// on the merchant form (UBO residential + trading addresses). Fixture mock when
// no key / INTEGRATIONS_MOCK selects it, so the form works before provisioning.
//
// Env (live): POSTCODER_API_KEY.

import { useMock } from "./mock";

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

function mockClient(): PostcoderClient {
  return {
    async lookup(postcode) {
      const pc = (postcode.trim() || "E14 5AB").toUpperCase();
      return [
        { summaryline: `Flat 1, 1 Example Street, London, ${pc}`, line1: "Flat 1", line2: "1 Example Street", city: "London", county: "Greater London", postcode: pc },
        { summaryline: `2 Example Street, London, ${pc}`, line1: "2 Example Street", line2: "", city: "London", county: "Greater London", postcode: pc },
      ];
    },
  };
}

export function getPostcoder(): PostcoderClient {
  const key = process.env.POSTCODER_API_KEY;
  return useMock("postcoder", Boolean(key)) ? mockClient() : liveClient(key!);
}
