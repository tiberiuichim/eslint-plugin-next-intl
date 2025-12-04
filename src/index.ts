import { rule as noMissingKeys } from "./rules/no-missing-keys.js";
import { rule as noDynamicKeys } from "./rules/no-dynamic-keys.js";

export const rules = {
  "no-missing-keys": noMissingKeys,
  "no-dynamic-keys": noDynamicKeys,
};

export const configs = {
  recommended: {
    plugins: ["next-intl"],
    rules: {
      "next-intl/no-missing-keys": "error",
      "next-intl/no-dynamic-keys": "warn",
    },
  },
};
