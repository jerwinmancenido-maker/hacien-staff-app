// Read-only pieces of the PO and receiving pages (server-safe, no hooks).

import { Chip, type ChipTone } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PO_STATUS_LABELS, PROGRESS_LABELS, type PoStatus, type ProgressState } from "@/lib/purchasing/status";
import { LINE_STATUS_LABELS, type LineStatus } from "@/lib/purchasing/match";

const PO_TONES: Record<PoStatus, ChipTone> = {
  DRAFT: "grey",
  APPROVED: "dark",
  SENT: "amber",
  PARTIALLY_RECEIVED: "amber",
  RECEIVED: "green",
  CLOSED: "grey",
  VOID: "red",
};

export function PoStatusChip({ status }: { status: string }) {
  return <Chip tone={PO_TONES[status as PoStatus] ?? "grey"}>{PO_STATUS_LABELS[status as PoStatus] ?? status}</Chip>;
}

export function RrStatusChip({ status }: { status: string }) {
  return <Chip tone={status === "VOID" ? "red" : "green"}>{status === "VOID" ? "Void" : "Posted"}</Chip>;
}

export function BillStatusChip({ status }: { status: string }) {
  const tone = status === "VOID" ? "red" : status === "PAID" ? "green" : status === "PARTIALLY_PAID" ? "amber" : "amber";
  const label =
    status === "VOID" ? "Void" : status === "PAID" ? "Paid" : status === "PARTIALLY_PAID" ? "Partially paid" : "Unpaid";
  return <Chip tone={tone}>{label}</Chip>;
}

const PROGRESS_TONES: Record<ProgressState, ChipTone> = { NOT_ORDERED: "grey", ORDERED: "dark", PARTIALLY_RECEIVED: "amber", RECEIVED: "green" };

export function ProgressChip({ state }: { state: ProgressState }) {
  return <Chip tone={PROGRESS_TONES[state]}>{PROGRESS_LABELS[state]}</Chip>;
}

const MATCH_TONES: Record<LineStatus, ChipTone> = { MATCHED: "green", QTY_MISMATCH: "amber", PRICE_MISMATCH: "red" };

export function MatchChip({ status }: { status: LineStatus }) {
  return <Chip tone={MATCH_TONES[status]}>{LINE_STATUS_LABELS[status]}</Chip>;
}

/** Received / ordered as a bar. */
export function QtyBar({ received, ordered, label }: { received: string; ordered: string; label: string }) {
  const o = Number(ordered);
  const pct = o > 0 ? Math.min(100, Math.round((Number(received) / o) * 100)) : 0;
  return (
    <div className="qty-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} className={pct >= 100 ? "full" : ""} />
    </div>
  );
}

export const qtyText = (q: string) => q.replace(/\.00$/, "");
export const day = (ymd: string | null | undefined) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export function AttachmentLinks({ files }: { files: { id: string; fileName: string; sizeBytes: number }[] }) {
  if (!files.length) return null;
  return (
    <ul className="attach-list">
      {files.map((f) => (
        <li key={f.id}>
          <a href={`/files/attachments/${f.id}`}>{f.fileName}</a> <span className="faint small">{Math.max(1, Math.round(f.sizeBytes / 1024))} KB</span>
        </li>
      ))}
    </ul>
  );
}
