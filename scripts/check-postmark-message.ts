import { config } from "dotenv";
config({ path: ".env.local", override: true });

(async () => {
  const id = process.argv[2];
  if (!id) { console.error("Usage: tsx scripts/check-postmark-message.ts <message_id>"); process.exit(1); }
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) { console.error("POSTMARK_SERVER_TOKEN missing"); process.exit(1); }
  const res = await fetch(`https://api.postmarkapp.com/messages/outbound/${id}/details`, {
    headers: { "X-Postmark-Server-Token": token, "Accept": "application/json" },
  });
  if (!res.ok) { console.error("Postmark:", res.status, await res.text()); process.exit(1); }
  const m = await res.json();
  console.log("From       :", m.From);
  console.log("To         :", m.To);
  console.log("ReplyTo    :", m.ReplyTo);
  console.log("Subject    :", m.Subject);
  console.log("ReceivedAt :", m.ReceivedAt);
  console.log("Status     :", m.Status);
})();
