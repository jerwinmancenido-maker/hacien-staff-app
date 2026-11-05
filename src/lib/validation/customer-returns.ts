// Audit D: customer return (credit memo). Lines are SO items with the
// quantity coming back; the service checks each against deliveredQty.
import { z } from "zod";
import { dateOnly } from "./quotes";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v ? v : null));

export const customerReturnInputSchema = z.object({
  returnDate: dateOnly("Return date"),
  reason: optionalText(5000),
  lines: z.array(z.object({ lineId: z.string().max(64), qty: z.string().max(20) })).max(500),
});
export type CustomerReturnInput = z.infer<typeof customerReturnInputSchema>;
