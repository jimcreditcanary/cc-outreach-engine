// Hot is retired — folded into the Deals board (Phase 4). The "due for a touch"
// signal is now a card highlight on /deals; the Work-Deal view lives at
// /hot/[id] and is reached by clicking a card. This list route redirects there.

import { redirect } from "next/navigation";

export default function HotRedirect() {
  redirect("/deals");
}
