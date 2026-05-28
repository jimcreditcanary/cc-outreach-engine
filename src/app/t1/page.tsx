import { redirect } from "next/navigation";

// T1 was merged into the Deals tab (the "Needs action" panel). Keep this
// route as a redirect so old links/bookmarks still land somewhere useful.
export default function T1Page() {
  redirect("/deals?tier=1");
}
