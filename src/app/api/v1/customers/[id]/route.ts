import type { NextRequest } from "next/server";
import { getCustomerForApi, serializeCustomer, writeCustomer } from "@/lib/api/customers";
import { withApi } from "@/lib/api/guard";
import { apiOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(req, { scope: "customers:read", permission: "view" }, async (api) => {
    const { id } = await ctx.params;
    return apiOk(await getCustomerForApi(id, api.user));
  });
}

export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(req, { scope: "customers:write", permission: "edit_data" }, async (api) => {
    const { id } = await ctx.params;
    const saved = await writeCustomer(id, api.body, api.user);
    return apiOk({ customer: serializeCustomer(saved, api.user) });
  });
}
