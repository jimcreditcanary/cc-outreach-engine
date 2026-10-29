"use server";

// Server actions for the Hot deal radar. The "work this deal" flow lives on
// /hot/[id]: that page pulls context + appraises (MEDDICC) and shows the
// questions; this action takes the operator's answers, drafts the email, and
// drops it into the workflow review queue (Outreach › Nurture). Nothing sends.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/server";
import { serviceClient } from "@/lib/db/client";
import { flash } from "@/lib/flash";
import { hubspotRepo, getDeal, dealRecentNotes } from "@/lib/hubspot/repo";
import { loadDraftConfig } from "@/lib/mailer/config";
import { draftFromAnswers, type DealContext } from "@/lib/mailer/dealWork";
import { insertDraft } from "@/lib/mailer/workflow";
import { textToHtml } from "@/lib/mailer/render";

const str = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

export async function draftFromAnswersAction(formData: FormData) {
  const me = await currentUser();
  if (!me) redirect("/login");

  const dealId = str(formData.get("deal_id"));
  const contactId = str(formData.get("contact_id"));
  if (!dealId) {
    await flash("error", "No deal given.");
    return redirect("/hot");
  }
  if (!contactId) {
    await flash("error", "No primary contact on that deal — add one in HubSpot, then try again.");
    return redirect(`/hot/${dealId}`);
  }

  // Reconstruct the question/answer pairs the page posted.
  const count = Number(str(formData.get("q_count")) || 0);
  const qa: { question: string; answer: string }[] = [];
  for (let i = 0; i < count; i++) {
    const question = str(formData.get(`q_text_${i}`));
    const answer = str(formData.get(`q_answer_${i}`));
    if (question) qa.push({ question, answer });
  }
  const assessment = {
    summary: str(formData.get("a_summary")),
    biggest_gap: str(formData.get("a_gap")),
    next_best_action: str(formData.get("a_nba")),
  };

  const db = serviceClient();
  const config = await loadDraftConfig(db, me.id);

  try {
    const [deal, contact] = await Promise.all([getDeal(dealId), hubspotRepo.getContact(contactId)]);
    if (!deal) {
      await flash("error", "Couldn't load that deal from HubSpot.");
      return redirect("/hot");
    }
    if (!contact?.email || contact.email_bounced) {
      await flash("error", "That contact has no usable email in HubSpot.");
      return redirect(`/hot/${dealId}`);
    }
    const [company, notes] = await Promise.all([
      contact.company_id ? hubspotRepo.getCompany(contact.company_id) : Promise.resolve(null),
      dealRecentNotes(dealId),
    ]);
    const ctx: DealContext = { deal, company, contact, notes };

    const draft = await draftFromAnswers({ ctx, assessment, qa, config });
    await insertDraft(db, {
      hs_contact_id: contact.id,
      email: contact.email,
      campaign: `deal-nurture-${new Date().toISOString().slice(0, 10)}`,
      subject: draft.subject,
      body_text: draft.body,
      body_html: textToHtml(draft.body),
      status: "queued",
      owner_id: me.id,
      meta: {
        contact_name: contact.full_name,
        kind: "deal-nurture",
        deal_id: deal.id,
        deal_name: deal.name,
        stage: deal.stage,
        angle: assessment.next_best_action,
      },
    });
    await flash("success", "Drafted — review and send it under Outreach › Nurture.");
  } catch (e) {
    await flash("error", `Draft failed: ${(e as Error).message}`);
    return redirect(`/hot/${dealId}`);
  }

  revalidatePath("/hot");
  redirect("/outreach?tab=nurture");
}
