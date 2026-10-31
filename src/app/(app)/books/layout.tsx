import { requirePagePermission } from "@/lib/auth/current-user";
import { isBooksEnabled } from "@/lib/books/features";
import { FeatureOffPage } from "@/components/FeatureOff";

export default async function BooksLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("view_books");
  if (!(await isBooksEnabled())) return <FeatureOffPage feature="Books" />;
  return children;
}
