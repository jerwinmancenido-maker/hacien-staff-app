"use client";

import { useActionState, useState, useTransition } from "react";
import { API_SCOPES } from "@/lib/api/scopes";
import { formatDate, formatDateTime } from "@/lib/format";
import { createApiKeyAction, revokeApiKeyAction, type CreateApiKeyState } from "./actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdByName: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "revoked" | "expired";
};

const initial: CreateApiKeyState = {};

export function ApiKeysTab({ keys, pepperSet }: { keys: ApiKeyRow[]; pepperSet: boolean }) {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initial);
  const [showOnce, setShowOnce] = useState(true);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const token = showOnce ? state.token : undefined;

  function revoke(id: string) {
    startTransition(async () => {
      const res = await revokeApiKeyAction(id);
      setRevokeMsg(res.message ?? null);
      setConfirmId(null);
    });
  }

  return (
    <div className="card">
      <h3>API keys</h3>
      <p className="small muted">
        Keys let other software use the staff app through /api/v1. Every key acts as the dedicated{" "}
        <strong>API / Bot</strong> user, so a key can never do more than that user could here — and it can never
        move money or send email. The full key is shown <strong>once</strong>, when it is created.
      </p>

      {!pepperSet && (
        <div className="alert error" role="status">
          <b>Keys can&apos;t be created yet.</b> The server setting API_KEY_PEPPER is not set, so the API is off
          (it fails closed). Once it is added on the server, this page can create keys.
        </div>
      )}

      {token && (
        <div className="alert ok" role="status">
          <p>
            <b>Your new API key — copy it now.</b> You will not see this again.
          </p>
          <p>
            <code className="api-key-token">{token}</code>
          </p>
          <p>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                void navigator.clipboard.writeText(token).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy key"}
            </button>{" "}
            <button
              type="button"
              className="btn small"
              onClick={() => setShowOnce(false)}
            >
              I have copied it
            </button>
          </p>
        </div>
      )}

      <form action={formAction} className="api-key-form">
        <div className="field">
          <label htmlFor="api-key-name">Key name</label>
          <input id="api-key-name" name="name" required minLength={3} maxLength={120} placeholder="e.g. PepStack sync" disabled={!pepperSet} />
        </div>
        <fieldset className="field">
          <legend>Scopes</legend>
          {API_SCOPES.map((s) => (
            <label key={s.value} className="check">
              <input type="checkbox" name="scopes" value={s.value} disabled={!pepperSet} /> {s.label}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="api-key-expiry">Expires</label>
          <select id="api-key-expiry" name="expiry" disabled={!pepperSet} defaultValue="none">
            <option value="none">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
          </select>
        </div>
        {state.message && !token && (
          <div className={state.ok ? "alert ok" : "alert error"} role="status">
            {state.message}
          </div>
        )}
        <button type="submit" className="btn primary" disabled={!pepperSet || pending}>
          Create key
        </button>
      </form>

      {revokeMsg && (
        <p className="small" role="status">
          {revokeMsg}
        </p>
      )}

      <div className="table-wrap">
        <table className="list" aria-label="API keys">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scopes</th>
              <th>Created by</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>
                  <div className="strong">{k.name}</div>
                  <div className="faint small">
                    starts {k.keyPrefix}… · created {formatDate(new Date(k.createdAt))}
                    {k.expiresAt ? ` · expires ${formatDate(new Date(k.expiresAt))}` : ""}
                  </div>
                </td>
                <td className="small">{k.scopes.join(", ") || "—"}</td>
                <td>{k.createdByName ?? "—"}</td>
                <td>{k.lastUsedAt ? formatDateTime(new Date(k.lastUsedAt)) : "Never"}</td>
                <td>{k.status === "active" ? "Active" : k.status === "revoked" ? "Revoked" : "Expired"}</td>
                <td>
                  {k.status === "active" &&
                    (confirmId === k.id ? (
                      <>
                        <button type="button" className="btn small danger" onClick={() => revoke(k.id)}>
                          Confirm revoke
                        </button>{" "}
                        <button type="button" className="btn small" onClick={() => setConfirmId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn small" onClick={() => setConfirmId(k.id)}>
                        Revoke
                      </button>
                    ))}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
