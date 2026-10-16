// Tiny, safe template rendering for campaign subject/body. Supports
// {{first_name}} and {{company}} with graceful fallbacks. Pure — tested.

export interface TemplateVars {
  first_name?: string | null;
  company?: string | null;
}

export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl
    .replace(/\{\{\s*first_name\s*\}\}/gi, vars.first_name?.trim() || "there")
    .replace(/\{\{\s*company\s*\}\}/gi, vars.company?.trim() || "your team");
}

/** Plain-text campaign body → simple paragraph HTML (double-newline = <p>,
 *  single newline = <br>). Escapes HTML so copy can't break the markup. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}
