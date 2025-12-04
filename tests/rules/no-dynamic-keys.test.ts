import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import { rule } from "../../src/rules/no-dynamic-keys.js";

const ruleTester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
});

describe("no-dynamic-keys", () => {
  it("runs the tests", () => {
    ruleTester.run("no-dynamic-keys", rule, {
      valid: [
        `
        const t = useTranslations();
        t('hello');
        `,
        `
        const t = useTranslations('namespace');
        t("hello");
        `
      ],
      invalid: [
        {
          code: `
          const t = useTranslations();
          const key = 'hello';
          t(key);
          `,
          errors: [{ messageId: "dynamicKey" }],
        },
        {
          code: `
          const t = useTranslations();
          t(\`hello\`);
          `,
          errors: [{ messageId: "dynamicKey" }],
        },
        {
          code: `
          const t = useTranslations();
          t('hello' + 'world');
          `,
          errors: [{ messageId: "dynamicKey" }],
        },
         {
          code: `
          const t = useTranslations();
          t(condition ? 'a' : 'b');
          `,
          errors: [{ messageId: "dynamicKey" }],
        },
      ],
    });
  });
});
