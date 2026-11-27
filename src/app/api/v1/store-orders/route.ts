import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/guard";
import { apiOk } from "@/lib/api/http";
import { createStoreOrderFromApi } from "@/lib/store-orders/intake";

export const dynamic = "force-dynamic";

/**
 * Store intake (Online Store plan rev 4, Slice 1): the website posts a paid
 * order here AFTER verifying the gateway payment notification itself.
 * Scope store-orders:write, the API bot guard permission edit_data (the bot
 * can never convert or void — conversion stays a staff click), transport
 * idempotency required; the record itself dedupes permanently on the
 * gateway key, so a re-post after the 24 h replay window returns the
 * existing order with duplicate: true instead of creating a second one.
 */
export function POST(req: NextRequest) {
  return withApi(req, { scope: "store-orders:write", permission: "edit_data", idempotency: "required" }, async (ctx) => {
    const result = await createStoreOrderFromApi(ctx.body, ctx.user);
    return apiOk(
      {
        storeOrder: {
          id: result.order.id,
          number: result.order.number,
          status: result.order.status,
          duplicate: result.duplicate,
        },
      },
      result.duplicate ? 200 : 201,
    );
  });
}
