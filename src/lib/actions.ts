// Turns known rule errors thrown by services into a form message.

import { ForbiddenError } from "./auth/current-user";
import { DocRuleError } from "./documents/common";
import { CompanyRuleError } from "./services/companies";
import { WithholdingRuleError } from "./services/withholding";
import { UserRuleError } from "./services/users";
import { SettingsConflictError } from "./settings/service";
import type { FormState } from "./validation/forms";

export async function runAction(fn: () => Promise<FormState>, values?: Record<string, string>): Promise<FormState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CompanyRuleError || e instanceof DocRuleError || e instanceof WithholdingRuleError) {
      return e.field ? { values, fieldErrors: { [e.field]: e.message } } : { values, message: e.message };
    }
    if (e instanceof ForbiddenError || e instanceof UserRuleError || e instanceof SettingsConflictError) {
      return { values, message: e.message };
    }
    throw e;
  }
}
