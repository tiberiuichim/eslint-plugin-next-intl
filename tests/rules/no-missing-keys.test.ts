import { describe, it, vi, afterEach } from "vitest";
import { RuleTester } from "eslint";
import { rule } from "../../src/rules/no-missing-keys.js";

// Mock loadMessages
// Note: We need to hoist the mock or use doMock
vi.mock("../../src/core.js", () => {
  return {
    loadMessages: vi.fn((cwd, dir, locale) => {
      // Returns a fixed set of keys for testing
      return new Set(["common.greeting", "auth.login", "nested.key"]);
    }),
  };
});

const ruleTester = new RuleTester({
  // @ts-ignore
  parser: require.resolve("@typescript-eslint/parser"),
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
});

describe("no-missing-keys", () => {
  it("runs the tests", () => {
    ruleTester.run("no-missing-keys", rule, {
      valid: [
        // Direct match
        `
        const t = useTranslations('common');
        t('greeting');
        `,
        // Nested match
        `
        const t = useTranslations();
        t('nested.key');
        `,
        // With namespace
        `
        const t = useTranslations('auth');
        t('login');
        `,
      ],
      invalid: [
        {
          code: `
          const t = useTranslations('common');
          t('missing');
          `,
          errors: [{ message: "Missing translation key: 'common.missing'" }],
        },
        {
          code: `
          const t = useTranslations();
          t('unknown.key');
          `,
          errors: [{ message: "Missing translation key: 'unknown.key'" }],
        },
        {
          code: `
          const t = useTranslations('auth');
          t('greeting'); 
          `,
          // auth.greeting is missing
          errors: [{ message: "Missing translation key: 'auth.greeting'" }],
        },
      ],
    });
  });

  it("respects settings configuration", () => {
    ruleTester.run("no-missing-keys-settings", rule, {
      valid: [],
      invalid: [
        {
          code: `
          const t = useTranslations('common');
          t('missing');
          `,
          settings: {
            "next-intl": {
              messagesDir: "custom/path",
              sourceLocale: "fr",
            },
          },
          errors: [{ message: "Missing translation key: 'common.missing'" }],
        },
      ],
    });
  });
});
