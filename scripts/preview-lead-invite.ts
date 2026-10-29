// Render the lead-invite emails to a single HTML file for review — no sending.
//   npm run preview-lead-invite   (writes the path it created)
import { writeFileSync } from "node:fs";
import { buildInviteEmail, type InviteStage } from "../src/lib/leads/invite";

const sample = { firstName: "Jane", company: "Northgate Lending Ltd", asset: "Embedded Lending Playbook", token: "sample-token-123" };
const stages: { stage: InviteStage; when: string }[] = [
  { stage: "invite", when: "Instantly, on lead capture" },
  { stage: "chase_48h", when: "48 hours later, if no booking" },
  { stage: "chase_7d", when: "7 days later, if still no booking (final)" },
];

const cards = stages
  .map(({ stage, when }) => {
    const e = buildInviteEmail(stage, sample);
    return (
      `<section style="margin:0 0 28px;border:1px solid #dde3ec;border-radius:10px;overflow:hidden;">` +
      `<div style="background:#0B1F3A;color:#fff;padding:10px 16px;font:600 13px/1.4 -apple-system,Segoe UI,Arial;">${when}</div>` +
      `<div style="padding:8px 16px;border-bottom:1px solid #eef1f6;font:14px/1.4 -apple-system,Segoe UI,Arial;color:#333;"><strong>Subject:</strong> ${e.subject}</div>` +
      `<div style="padding:18px 16px;">${e.htmlBody}</div>` +
      `</section>`
    );
  })
  .join("");

const html =
  `<!doctype html><meta charset="utf-8"><title>Lead invite — preview</title>` +
  `<div style="max-width:620px;margin:24px auto;font-family:-apple-system,Segoe UI,Arial;padding:0 16px;">` +
  `<h1 style="font-size:18px;color:#0B1F3A;">Lead invite emails — preview (nothing sent)</h1>` +
  `<p style="color:#555;font-size:14px;">Sample lead: Jane at Northgate Lending Ltd, downloaded "Embedded Lending Playbook".</p>` +
  cards +
  `</div>`;

const out = `${process.env.PREVIEW_OUT ?? "/tmp"}/lead-invite-preview.html`;
writeFileSync(out, html);
console.log(out);
