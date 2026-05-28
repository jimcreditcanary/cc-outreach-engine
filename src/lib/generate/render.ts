// Render edited plain-text email body to native-looking HTML (paragraphs,
// linkified URLs). Used when an operator edits a draft in the queue.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function textToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      const linked = escapeHtml(p).replace(
        /(https?:\/\/[^\s<]+?)([.,;:!?)\]]*)(?=\s|$)/g,
        '<a href="$1">$1</a>$2',
      );
      return `<p>${linked.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">
${paragraphs}
</div>`;
}
