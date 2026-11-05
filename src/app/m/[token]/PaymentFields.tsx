"use client";

// Client-interactive payment-page field: the recent-bank-statement question.
//  • label names the company (6l)
//  • three answers: Yes / No / I'll provide separately via email (6m)
//  • the upload shows only on Yes; the "explain why" only on No; neither on email (6k)

import { useState } from "react";

const field = "w-full rounded-md border border-neutral-300 px-3 py-2.5 text-sm focus:border-[#003566] focus:outline-none focus:ring-1 focus:ring-[#003566]";
const lbl = "block text-sm font-medium text-neutral-800 mb-1";
const fileInput = "mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded file:border-0 file:bg-[#003566] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[#002a52]";

export function BankStatementQuestion({ companyName, answerValue, reasonDefault }: {
  companyName: string; answerValue: string; reasonDefault: string;
}) {
  const [val, setVal] = useState(answerValue);
  const label = `Can you provide a recent bank statement${companyName ? ` for ${companyName}` : ""}?`;
  return (
    <div className="sm:col-span-2">
      <span className={lbl}>{label} <span className="text-red-600">*</span></span>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" name="pay_bank_statement" value="yes" checked={val === "yes"} onChange={() => setVal("yes")} /> Yes</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="pay_bank_statement" value="no" checked={val === "no"} onChange={() => setVal("no")} /> No</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="pay_bank_statement" value="email" checked={val === "email"} onChange={() => setVal("email")} /> I&apos;ll provide separately via email</label>
      </div>
      {val === "yes" && (
        <div className="mt-2">
          <label htmlFor="bank_statement_file" className={lbl}>Upload your recent bank statement</label>
          <input id="bank_statement_file" name="bank_statement_file" type="file" accept=".pdf,.png,.jpg,.jpeg" className={fileInput} />
        </div>
      )}
      {val === "no" && (
        <div className="mt-2">
          <label htmlFor="pay_bank_statement_reason" className={lbl}>Please explain why</label>
          <input id="pay_bank_statement_reason" name="pay_bank_statement_reason" defaultValue={reasonDefault} className={field} />
        </div>
      )}
    </div>
  );
}
