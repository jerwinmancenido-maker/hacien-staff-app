import { requireUser } from "@/lib/auth/current-user";
import { EmptyState, PageHeader } from "@/components/ui";

export async function ComingSoon({ title, line }: { title: string; line: string }) {
  await requireUser();
  return (
    <>
      <PageHeader title={title} subtitle="Coming soon" />
      <div className="card">
        <EmptyState title="Coming soon" line={line} />
      </div>
    </>
  );
}
