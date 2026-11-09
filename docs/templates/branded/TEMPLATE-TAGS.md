# Merge-tag glossary — merchant-onboarding templates

docxtemplater (`.docx`) and exceljs (`.xlsx`) fill these per merchant. Delimiters are the
docxtemplater defaults `{tag}`. Loops use `{#name} … {/name}`; conditionals use the same
section syntax. Tag names are reused across documents for the same concept.

Brand: Credit Canary navy **`#003566`** (found in `/Users/jamesfell/credit-canary-website/css/shared.css`,
token `--cc-navy`), canary accent `#FFD600`. Logo embedded at top of the two branded forms,
rendered from `/Users/jamesfell/credit-canary-website/images/cc-logo.svg`.

---

## Shared / core tags (used in more than one document)

| Tag | Meaning |
|---|---|
| `{client_legal_name}` | Registered legal entity name |
| `{client_trading_name}` | Public-facing trading name(s) |
| `{client_reg_number}` | Companies House number or mutual-society registration number (e.g. an `IP…C` number) |
| `{client_reg_clause}` | Inline registration descriptor in the contracts, e.g. `with company number` or `as an industrial and provident society with registration number` |
| `{client_company_type}` | Entity type, e.g. "Private Limited Company (Ltd) · England & Wales" |
| `{client_registered_office}` | Registered office address |
| `{client_principal_office}` | Principal office address (TU Credit EUA only) |
| `{client_trading_address}` | Trading / principal place of business address |
| `{client_phone}` | Main / key-contact phone number |
| `{client_email}` | Main / key-contact email |
| `{client_website}` | Website URL |
| `{signatory_name}` | Authorised signatory full name |
| `{signatory_title}` | Authorised signatory role / title |
| `{signatory_email}` | Authorised signatory email |
| `{agreement_version}` | TransUnion agreement version number (contracts) |
| `FN______` | **Literal** placeholder (not a merge tag) for TransUnion to assign the Reseller / File Number by hand (contracts) |

---

## 1. Direct Debit Onboarding Questionnaire.template.docx

CC-branded (logo + navy, already present). Only the Section 1 "Company information" answer
cells a generator can pre-fill are tagged; all contact / DD-detail / bank fields are left blank
for the merchant to complete.

| Tag | Field |
|---|---|
| `{client_legal_name}` | 1.1 Registered Legal Entity Name |
| `{client_trading_name}` | 1.2 Trading Name/Styles |
| `{client_registered_office}` | 1.3 Company Registered Address |
| `{client_trading_address}` | 1.4 Company Trading Address |
| `{client_reg_number}` | 1.5 Company/Charity Registration Number |
| `{client_website}` | 1.6 Company website |

---

## 2. Merchant Onboarding Form.template.docx

CC-branded (logo added; section headings recoloured to brand navy). Green (Companies-House
pre-filled) rows → tags; amber (merchant-completed) rows left blank. All Pozitive Energy
content removed. The directors, PSC-conclusion, attributable-ownership and UBO-KYC blocks are
docxtemplater loops.

**Entity (section 1)**

| Tag | Field |
|---|---|
| `{client_legal_name}` | Registered legal name (also subtitle, settlement account, sign-off, ownership chart) |
| `{client_reg_number}` | Companies House number (also subtitle, ownership chart) |
| `{client_company_type}` | Company type |
| `{client_status}` | Status (incorporation / active) |
| `{client_registered_office}` | Registered office |
| `{client_sic_code}` | SIC code (nature of business) |
| `{client_accounts_filing}` | Accounts-filing status |
| `{client_confirmation_statement}` | Confirmation-statement status |
| `{client_charges}` | Charges on file |
| `{client_insolvency}` | Insolvency history |

**People (section 2)**

| Tag | Meaning |
|---|---|
| `{#directors} … {/directors}` | Loop over current directors (one table row per director) |
| `{director_name}` | Director name (inside loop) |
| `{director_details}` | Director DOB / nationality / appointment / verification line (inside loop) |
| `{psc_name}` | Active PSC name |
| `{psc_details}` | Active PSC detail block (type, address, notified date, nature of control) |
| `{historic_pscs}` | Ceased / historic PSCs (free-text block) |
| `{#ubo_conclusions} … {/ubo_conclusions}` | Loop over the UBO-conclusion table |
| `{ubo_conclusion_name}` | UBO-conclusion subject (inside loop) |
| `{ubo_conclusion_assessment}` | UBO-conclusion assessment (inside loop) |
| `{#attributable_ownership} … {/attributable_ownership}` | Loop over the attributable-ownership table |
| `{ao_name}` | Attributable-ownership subject (inside loop) |
| `{ao_detail}` | Attributable % range + chain path (inside loop) |
| `{#ubos} … {/ubos}` | Loop over the per-UBO KYC block (repeats header + KYC table per UBO) |
| `{ubo_full_name}` | UBO full legal name (inside loop) |
| `{ubo_dob}` | UBO date of birth from CH (inside loop) |
| `{ubo_nationality}` | UBO nationality (inside loop) |
| `{ubo_country}` | UBO country of residence (inside loop) |
| `{signatory_name}` | Authorised signatory name |
| `{signatory_title}` | Authorised signatory role / title |
| `{signatory_email}` | Authorised signatory email |

> The visual ownership-chain boxes were generalised to a tag-driven scaffold
> (operating entity = `{client_legal_name}` / `{client_reg_number}`; upper layers carry generic
> "complete per your structure" guidance). Exact-%, residential-address, ID, proof-of-address,
> PEP and consent fields inside the UBO loop stay blank for the merchant to complete.

---

## 3. TU Credit EUA.template.docx  (from the GBCU "TU Doc")

TransUnion branding, logos and contractual boilerplate left **unchanged**. Only client-specific
values replaced. The Credit Canary "Authorised Data Processor" block (company no. 14117508,
Cardiff) is left **verbatim** — it is constant, not a tag.

| Tag | Field |
|---|---|
| `{client_legal_name}` | Client name (front page, signature block, Primary Schedule) |
| `{client_reg_clause}` | Registration descriptor on the front page |
| `{client_reg_number}` | Client company/registration number (front page + Primary Schedule) |
| `{client_registered_office}` | Registered Office Address (front page + Primary Schedule) |
| `{client_principal_office}` | Principal Office Address (Primary Schedule) |
| `{client_trading_address}` | Trading Address (Primary Schedule) |
| `{client_phone}` | Client telephone (Primary Schedule) |
| `{client_email}` | Client e-mail (Primary Schedule) |
| `{agreement_version}` | "Version:" number (TransUnion use-only box) |
| `FN______` | Reseller File Number — literal blank for TU to assign |

---

## 4. TU Monevo EUA.template.docx  (from the Wiltshire & Swindon / Monevo doc)

TransUnion / Monevo branding and boilerplate left **unchanged**. CC "Authorised Data Processor"
block (14117508, Cardiff) left **verbatim**. Monevo Limited (the counterparty) and its
One-Park-Lane address are the counterparty, not the client — kept.

| Tag | Field |
|---|---|
| `{client_legal_name}` | Client name (front page, signature block, Primary Schedule) |
| `{#client_trading_name} (trading as {client_trading_name}){/client_trading_name}` | Optional "(trading as …)" — renders only when a trading name is supplied |
| `{client_reg_clause}` | Registration descriptor on the front page |
| `{client_reg_number}` | Client registration number (front page + Primary Schedule) |
| `{client_registered_office}` | Registered Office Address (front page + Primary Schedule) |
| `{client_trading_address}` | Trading Address (Primary Schedule) |
| `{client_phone}` | Client telephone (Primary Schedule) |
| `{client_email}` | Client e-mail (Primary Schedule) |
| `{agreement_version}` | "Version:" number (appears twice) |
| `FN______` | File Number — literal blank for TU to assign (appears twice) |
| `{monevo_setup_fee}` | Payment Schedule — Set-Up Fee |
| `{monevo_monthly_platform_fee}` | Payment Schedule — Monthly Platform Fee amount ("per calendar month" kept literal) |
| `{monevo_loan_threshold}` | Payment Schedule — CPA loan-size band threshold (appears twice) |
| `{monevo_cpa_rate_high}` | CPA rate for loans above the threshold |
| `{monevo_cpa_rate_low}` | CPA rate for loans at/below the threshold |

---

## 5. TU End User Due Diligence.template.xlsx  (from the GBCU TU DD)

TransUnion checklist left intact. Only the end-user identity header fields and the two
client-specific comment cells are tagged; the Yes/No/N/A assessment answers are left as the
reference defaults for the assessor / generator to overwrite per end-user.

| Cell | Tag | Field |
|---|---|---|
| C4 | `{signatory_name}` | Contact Name |
| C5 | `{signatory_title}` | Contact Title |
| C6 | `{client_phone}` | Contact Phone |
| C7 | `{client_email}` | Contact Email |
| C8 | `{client_ico_number}` | ICO Registration Number |
| C9 | `{client_reg_number}` | Companies House Number |
| C10 | `{client_fca_frn}` | FCA Registration Number |
| C11 | `{client_dpo}` | Data Protection Officer |
| H27 | `{client_privacy_policy_url}` | Privacy-policy URL (GDPR Q3.5 comment) |
| H34 | `{client_trade_body}` | Trade-association membership (Q6.1 comment) |
