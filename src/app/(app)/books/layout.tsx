import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";

export default async function BooksLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) notFound();
  return children;
}
