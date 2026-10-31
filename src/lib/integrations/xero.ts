// Xero adapter — create/update a contact and raise sales invoices (ACCREC).
// Live auth is a Custom Connection (client-credentials) scoped to the Credit
// Canary org; until XERO_CLIENT_ID + XERO_CLIENT_SECRET are set the mock runs,
// so the whole invoice run works end-to-end without Xero wired. The mock is
// deterministic (stable ids) so tests + dry-runs are reproducible.
//
// Env (live): XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_TENANT_ID.

import { createHash } from "crypto";
import { useMock } from "./mock";

export interface XeroContactInput {
  accountKey: string;                 // our stable key (billing account id) → deterministic mock id
  name: string;
  registeredAddress?: string | null;
  financeContact?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  vatNumber?: string | null;
}

export interface XeroInvoiceLine {
  description: string;
  quantity: number;
  unitAmountPence: number;
  vatRate: number;                    // 0 or 0.2
}

export interface XeroInvoiceInput {
  contactId: string;
  reference: string;                  // our invoice reference (account + period)
  periodMonth: string;                // YYYY-MM-01
  dueDate: string;                    // YYYY-MM-DD
  lines: XeroInvoiceLine[];
}

export interface XeroInvoiceResult { invoiceId: string; status: string; }

export interface XeroClient {
  ensureContact(input: XeroContactInput): Promise<{ contactId: string }>;
  createInvoice(input: XeroInvoiceInput, approve: boolean): Promise<XeroInvoiceResult>;
  emailInvoice(invoiceId: string): Promise<void>;
  getInvoiceStatus(invoiceId: string): Promise<{ status: string; paid: boolean }>;
}

const p2 = (pence: number) => (pence / 100).toFixed(2);

// ─── mock ─────────────────────────────────────────────────────────────────────
function mockClient(): XeroClient {
  const id = (prefix: string, seed: string) => `${prefix}_${createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
  return {
    async ensureContact(input) { return { contactId: id("xc", input.accountKey) }; },
    async createInvoice(input, approve) { return { invoiceId: id("xinv", input.reference), status: approve ? "AUTHORISED" : "DRAFT" }; },
    async emailInvoice() { /* no-op in mock */ },
    async getInvoiceStatus() { return { status: "AUTHORISED", paid: false }; },
  };
}

// ─── live (Custom Connection, client-credentials) ─────────────────────────────
let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const id = process.env.XERO_CLIENT_ID, secret = process.env.XERO_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Xero not configured (XERO_CLIENT_ID / XERO_CLIENT_SECRET).");
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "accounting.transactions accounting.contacts" }),
  });
  if (!res.ok) throw new Error(`Xero token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function xeroFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Xero-Tenant-Id": process.env.XERO_TENANT_ID ?? "", Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Xero ${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function liveClient(): XeroClient {
  return {
    async ensureContact(input) {
      const body = {
        Contacts: [{
          Name: input.name,
          ...(input.financeContact?.email ? { EmailAddress: input.financeContact.email } : {}),
          ...(input.financeContact?.name ? { FirstName: input.financeContact.name } : {}),
          ...(input.vatNumber ? { TaxNumber: input.vatNumber } : {}),
          ...(input.registeredAddress ? { Addresses: [{ AddressType: "STREET", AddressLine1: input.registeredAddress }] } : {}),
        }],
      };
      const j = await xeroFetch<{ Contacts: { ContactID: string }[] }>("/Contacts", { method: "POST", body: JSON.stringify(body) });
      return { contactId: j.Contacts[0]!.ContactID };
    },
    async createInvoice(input, approve) {
      const body = {
        Invoices: [{
          Type: "ACCREC",
          Contact: { ContactID: input.contactId },
          Date: input.periodMonth.slice(0, 10),
          DueDate: input.dueDate,
          Reference: input.reference,
          Status: approve ? "AUTHORISED" : "DRAFT",
          LineAmountTypes: "Exclusive",
          LineItems: input.lines.map((l) => ({
            Description: l.description,
            Quantity: l.quantity,
            UnitAmount: Number(p2(l.unitAmountPence)),
            TaxType: l.vatRate > 0 ? "OUTPUT2" : "EXEMPTOUTPUT",
          })),
        }],
      };
      const j = await xeroFetch<{ Invoices: { InvoiceID: string; Status: string }[] }>("/Invoices", { method: "POST", body: JSON.stringify(body) });
      return { invoiceId: j.Invoices[0]!.InvoiceID, status: j.Invoices[0]!.Status };
    },
    async emailInvoice(invoiceId) { await xeroFetch(`/Invoices/${invoiceId}/Email`, { method: "POST", body: "{}" }); },
    async getInvoiceStatus(invoiceId) {
      const j = await xeroFetch<{ Invoices: { Status: string; AmountDue: number }[] }>(`/Invoices/${invoiceId}`);
      const inv = j.Invoices[0];
      return { status: inv?.Status ?? "UNKNOWN", paid: inv?.Status === "PAID" || (inv?.AmountDue ?? 1) === 0 };
    },
  };
}

export function getXero(): XeroClient {
  const hasCreds = !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
  return useMock("xero", hasCreds) ? mockClient() : liveClient();
}
