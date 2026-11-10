import type { NextRequest } from "next/server";
import { listCustomersForApi, serializeCustomer, writeCustomer } from "@/lib/api/customers";
import { withApi } from "@/lib/api/guard";
import { apiOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withApi(req, { scope: "customers:read", permission: "view" }, async (ctx) => {
    return apiOk(await listCustomersForApi(req.nextUrl.searchParams, ctx.user));
  });
}

export function POST(req: NextRequest) {
  return withApi(req, { scope: "customers:write", permission: "edit_data", idempotency: "required" }, async (ctx) => {
    const saved = await writeCustomer(null, ctx.body, ctx.user);
    return apiOk({ customer: serializeCustomer(saved, ctx.user) }, 201);
  });
}
