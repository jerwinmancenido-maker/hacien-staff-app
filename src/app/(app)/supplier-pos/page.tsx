import { redirect } from "next/navigation";

// Old sidebar link: supplier POs live at /purchase-orders.
export default function Page() {
  redirect("/purchase-orders");
}
