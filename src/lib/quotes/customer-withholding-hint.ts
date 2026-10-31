/**
 * Staff-facing withholding hint under Customer on the quote editor / add-customer drawer.
 * Driven by the saved pick (Customer.defaultWithholding / quote withholdingPick),
 * never by customer type. Type is a label only.
 */
export {
  customerWithholdingHint,
  customerWithholdingChipLabel,
  formatWithholdingPickPart,
  WITHHOLDING_HINT_NOT_SET,
  WITHHOLDING_HINT_NONE,
} from "./withholding-defaults";
