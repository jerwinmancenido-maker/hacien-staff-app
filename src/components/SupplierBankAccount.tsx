"use client";

import { useState } from "react";
import { revealSupplierBankAccountAction } from "@/app/(app)/suppliers/actions";

export function SupplierBankAccount({
  supplierId,
  initialValue,
  isAdmin,
}: {
  supplierId: string;
  initialValue: string;
  isAdmin?: boolean;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!initialValue) {
    return <span className="faint">—</span>;
  }

  if (!isAdmin) {
    return <span>{initialValue}</span>;
  }

  if (revealed !== null) {
    return <span>{revealed}</span>;
  }

  const handleReveal = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await revealSupplierBankAccountAction(supplierId);
      if (res.ok && res.bankAccountNumber !== undefined) {
        setRevealed(res.bankAccountNumber || "—");
      } else {
        setError(res.message || "Failed to reveal bank number.");
      }
    } catch {
      setError("Failed to reveal bank number.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span>{initialValue}</span>
      <button
        type="button"
        className="btn-link small"
        disabled={loading}
        onClick={handleReveal}
      >
        {loading ? "Revealing…" : "Show full number"}
      </button>
      {error && <span className="small text-red-600">{error}</span>}
    </span>
  );
}
