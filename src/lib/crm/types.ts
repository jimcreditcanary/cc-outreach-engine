// Backend-agnostic CRM domain types + repository interface. The app's pages
// and server actions depend ONLY on these, never on HubSpot (or Supabase)
// shapes directly — so the data source can be swapped behind getCrm() without
// touching the UI. This is the seam for the HubSpot migration (P1).

/** A contact as the console cares about it — the union of what the contacts
 *  list and detail pages render. Backend ids are opaque strings. */
export interface ContactRecord {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  mobile: string | null;
  /** The associated company, when known (name is enough for list rows). */
  company_id: string | null;
  company_name: string | null;
  /** True when this is an un-actioned new lead (HubSpot hs_lead_status=NEW). */
  is_new: boolean;
  /** Raw outreach status (HubSpot hs_lead_status), for detail views. */
  lead_status: string | null;
  /** Address inferred from a company pattern, not verified
   *  (HubSpot email_status = Extrapolated). Held back from outreach. */
  email_guessed: boolean;
  /** Hard-bounced — never send (derived from HubSpot bounce signals). */
  email_bounced: boolean;
  lead_source: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Link to the record in HubSpot's UI. */
  url: string;
}

export interface CompanyRecord {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  created_at: string | null;
  updated_at: string | null;
  url: string;
}

/** Fields the console can write to a contact. All optional on update. */
export interface ContactWrite {
  full_name?: string;
  email?: string;
  job_title?: string | null;
  mobile?: string | null;
  /** Flag/unflag as a new lead → hs_lead_status NEW vs IN_PROGRESS. */
  is_new?: boolean;
  /** Mark the email as guessed (Extrapolated) vs confirmed (Verified). */
  email_guessed?: boolean;
  lead_source?: string | null;
  /** Associate with this company on create/update. */
  company_id?: string | null;
}

export type SortDir = "asc" | "desc";

export interface ListContactsOpts {
  /** Free-text across name / email / company. */
  q?: string;
  /** New-leads tab. */
  newOnly?: boolean;
  limit?: number;
  /** Opaque forward cursor (HubSpot `after`). */
  after?: string;
  sort?: { col: "full_name" | "job_title" | "email" | "created_at"; dir: SortDir };
}

export interface ListCompaniesOpts {
  q?: string;
  limit?: number;
  after?: string;
  sort?: { col: "name" | "industry" | "created_at"; dir: SortDir };
}

/** One page of results plus the forward cursor and overall match count. */
export interface Page<T> {
  records: T[];
  total: number;
  /** Cursor for the next page, or undefined when exhausted. */
  after?: string;
}

/** The contract every backend (HubSpot now, Supabase for parity) implements. */
export interface CrmRepository {
  listContacts(opts: ListContactsOpts): Promise<Page<ContactRecord>>;
  getContact(id: string): Promise<ContactRecord | null>;
  createContact(input: ContactWrite): Promise<ContactRecord>;
  updateContact(id: string, patch: ContactWrite): Promise<ContactRecord>;

  listCompanies(opts: ListCompaniesOpts): Promise<Page<CompanyRecord>>;
  getCompany(id: string): Promise<CompanyRecord | null>;
}
