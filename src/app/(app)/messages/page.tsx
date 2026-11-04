import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { maskRecipient } from "@/lib/messaging/phone";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { getSettingsSnapshot } from "@/lib/settings";
import { retryMessageFormAction, saveOrderTextTogglesFormAction } from "./actions";

const PAGE_SIZE = 50;

export default async function MessagesPage() {
  await requirePagePermission("manage_settings");
  const rows = await db.messageLog.findMany({ orderBy: { createdAt: "desc" }, take: PAGE_SIZE });
  const { settings } = await getSettingsSnapshot();
  const t = settings.messaging;
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Admin send log. Recipients are always shown masked, even to Admins."
      />
      <form action={saveOrderTextTogglesFormAction} className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h2>Order text updates</h2>
        </div>
        <p className="faint small">
          Short UniSMS texts, sender HACIEN, first name + sales order number only. A template on
          alone sends nothing while “Order texts on” is off, and nothing is sent until the provider
          keys are set. Default chosen: all off until UniSMS keys, the UniSMS DPA + DB location, and
          the HACIEN sender ID are confirmed.
        </p>
        <div>
          <label>
            <input type="checkbox" name="orderTextsEnabled" defaultChecked={t.orderTextsEnabled} /> Order texts on
          </label>
        </div>
        <div>
          <label>
            <input type="checkbox" name="orderConfirmed" defaultChecked={t.orderConfirmed} /> Order confirmed
          </label>
        </div>
        <div>
          <label>
            <input type="checkbox" name="orderDelivered" defaultChecked={t.orderDelivered} /> Delivered (fully delivered only)
          </label>
        </div>
        <div>
          <label>
            <input type="checkbox" name="orderPayment" defaultChecked={t.orderPayment} /> Payment received (once per collection)
          </label>
        </div>
        <button type="submit" className="btn" style={{ marginTop: 12 }}>
          Save order text toggles
        </button>
      </form>
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
