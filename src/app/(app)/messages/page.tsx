import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { maskRecipient } from "@/lib/messaging/phone";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { retryMessageFormAction } from "./actions";

const PAGE_SIZE = 50;

export default async function MessagesPage() {
  await requirePagePermission("manage_settings");
  const rows = await db.messageLog.findMany({ orderBy: { createdAt: "desc" }, take: PAGE_SIZE });
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Admin send log. Recipients are always shown masked, even to Admins."
      />
      {rows.length === 0 ? (
        <EmptyState title="No messages sent yet" line="Every SMS and email sent through the messaging base is logged here." />
      ) : (
        <DataTable
          label="Message send log"
          columns={[
            { key: "when", label: "When" },
            { key: "channel", label: "Channel" },
            { key: "to", label: "To" },
            { key: "status", label: "Status" },
            { key: "provider", label: "Provider" },
            { key: "attempts", label: "Attempts", numeric: true },
            { key: "action", label: "" },
          ]}
          rows={rows.map((row) => ({
            id: row.id,
            cells: {
              when: formatDateTime(row.createdAt),
              channel: row.channel,
              to: maskRecipient(row.channel, row.recipient),
              status: (
                <Chip tone={row.status === "sent" ? "green" : row.status === "not_sent" ? "amber" : "red"}>
                  {row.status === "not_sent" ? "not sent: not set up" : row.status}
                </Chip>
              ),
              provider: row.provider,
              attempts: String(row.attempts),
              action:
                row.status === "sent" ? (
                  ""
                ) : (
                  <form action={retryMessageFormAction.bind(null, row.id)}>
                    <button type="submit" className="btn btn-small">
                      Retry
                    </button>
                  </form>
                ),
            },
          }))}
        />
      )}
      <p className="faint small">
        Nothing is sent until the CTO sets the provider keys. Until then, attempts are logged as
        “not sent: not set up”. Go-live is blocked until the UniSMS DPA, DB location, and HACIEN
        sender ID are in place.
      </p>
    </>
  );
}
