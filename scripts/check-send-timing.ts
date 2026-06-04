import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createClient } from "@supabase/supabase-js";

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Ross's send
  const sendId = "4410f664-f045-45ec-bc55-e967f140eb59";
  const { data: send } = await db.from("sends").select("*").eq("id", sendId).maybeSingle();
  console.log("SEND ROW:");
  console.log(JSON.stringify(send, null, 2));

  // Ross's user_settings timeline
  const rossId = "8f65212f-54bb-43bb-9cab-00afda102510";
  const { data: us } = await db.from("user_settings").select("user_id, from_email, reply_to_email, created_at, updated_at, postmark_signature_id, postmark_signature_verified, postmark_signature_checked_at").eq("user_id", rossId).maybeSingle();
  console.log("\nROSS user_settings:");
  console.log(JSON.stringify(us, null, 2));

  // Hit the same resolveSenderIdentity code path
  const ownerId = (send?.owner_id ?? null) as string | null;
  const envFrom = process.env.POSTMARK_FROM ?? "Jim Fell <jim@mail.creditcanary.co.uk>";
  const envReply = process.env.POSTMARK_REPLY_TO ?? "jimfell@creditcanary.co.uk";
  let from = envFrom, replyTo = envReply;
  if (ownerId) {
    const { data } = await db.from("user_settings").select("from_email, reply_to_email").eq("user_id", ownerId).maybeSingle();
    from = data?.from_email || envFrom;
    replyTo = data?.reply_to_email || envReply;
  }
  console.log("\nIf re-sent NOW, sendBroadcast would resolve:");
  console.log("  From   :", from);
  console.log("  ReplyTo:", replyTo);
})();
