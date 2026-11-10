import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/guard";
import { apiOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** Proves the key is accepted. No business data. */
export function GET(req: NextRequest) {
  return withApi(req, {}, async () => apiOk({ status: "ok" }));
}
