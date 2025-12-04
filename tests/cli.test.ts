import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../src/cli.ts");
const TEMP_DIR = path.resolve(__dirname, "temp-cli-test");

// Helper to run the CLI
async function runCli(args: string[] = []) {
  try {
    const result = await execa("npx", ["tsx", CLI_PATH, ...args], {
      cwd: TEMP_DIR,
      reject: false, // Don't throw on exit code != 0
    });
    return result;
  } catch (e) {
    return e as Record<string, unknown>;
  }
}

describe("CLI", () => {
  beforeEach(() => {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR);
    fs.mkdirSync(path.join(TEMP_DIR, "src"));
    fs.mkdirSync(path.join(TEMP_DIR, "src/messages"));
  });

  afterEach(() => {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  });

  it("should pass when all keys are used and defined", async () => {
    // Setup en.json
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/messages/en.json"),
      JSON.stringify({ common: { greeting: "Hello" } }, null, 2),
    );

    // Setup component
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/App.tsx"),
      `
      import { useTranslations } from 'next-intl';
      export function App() {
        const t = useTranslations('common');
        return <div>{t('greeting')}</div>;
      }
      `,
    );

    const { stdout, exitCode } = await runCli(["--check"]);

    expect(stdout).toContain("Found 1 defined keys");
    expect(stdout).toContain("Found 1 unique used keys");
    expect(stdout).toContain("All checks passed!");
    expect(exitCode).toBe(0);
  }, 10000);

  it("should report missing keys and exit with error", async () => {
    // Setup en.json
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/messages/en.json"),
      JSON.stringify({ common: { greeting: "Hello" } }, null, 2),
    );

    // Setup component using missing key
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/App.tsx"),
      `
      import { useTranslations } from 'next-intl';
      export function App() {
        const t = useTranslations('common');
        return <div>{t('missing.key')}</div>;
      }
      `,
    );

    const { stdout, stderr, exitCode } = await runCli(["--check"]);

    expect(stdout).toContain("Found 1 defined keys");
    expect(stderr).toContain("Found 1 missing messages");
    expect(stderr).toContain("- common.missing.key");
    expect(exitCode).toBe(1);
  }, 10000);

  it("should report unused keys", async () => {
    // Setup en.json with unused key
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/messages/en.json"),
      JSON.stringify(
        { common: { greeting: "Hello", unused: "Unused" } },
        null,
        2,
      ),
    );

    // Setup component
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/App.tsx"),
      `
      import { useTranslations } from 'next-intl';
      export function App() {
        const t = useTranslations('common');
        return <div>{t('greeting')}</div>;
      }
      `,
    );

    const { stdout, exitCode } = await runCli(["--check"]);

    expect(stdout).toContain("Found 2 defined keys");
    expect(stdout).toContain("Found 1 unique used keys");
    expect(stdout).toContain("Found 1 unused messages");
    expect(stdout).toContain("- common.unused");
    expect(stdout).toContain("Run with --fix to remove these keys");
    expect(exitCode).toBe(0);
  }, 10000);

  it("should fix unused keys when --fix is passed", async () => {
    const messagesPath = path.join(TEMP_DIR, "src/messages/en.json");

    // Setup en.json with unused key
    fs.writeFileSync(
      messagesPath,
      JSON.stringify(
        { common: { greeting: "Hello", unused: "Unused" } },
        null,
        2,
      ),
    );

    // Setup component
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/App.tsx"),
      `
      import { useTranslations } from 'next-intl';
      export function App() {
        const t = useTranslations('common');
        return <div>{t('greeting')}</div>;
      }
      `,
    );

    const { stdout, exitCode } = await runCli(["--fix"]);

    expect(stdout).toContain("Fixing... removing unused keys");
    expect(stdout).toContain("Updated en.json");
    expect(exitCode).toBe(0);

    // Verify file content
    const content = JSON.parse(fs.readFileSync(messagesPath, "utf-8"));
    expect(content).toEqual({ common: { greeting: "Hello" } });
    // Ensure 'unused' is gone from 'common'
    expect((content.common as Record<string, unknown>).unused).toBeUndefined();
  }, 10000);

  it("should warn about dynamic keys", async () => {
    // Setup en.json
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/messages/en.json"),
      JSON.stringify({ greeting: "Hello" }, null, 2),
    );

    // Setup component with dynamic usage
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/App.tsx"),
      `
      import { useTranslations } from 'next-intl';
      export function App() {
        const t = useTranslations();
        const key = 'greeting';
        return <div>{t(key)}</div>;
      }
      `,
    );

    const { stderr, exitCode } = await runCli(["--check"]);

    expect(stderr).toContain(
      "dynamic usages which cannot be statically analyzed",
    );
    expect(exitCode).toBe(0);
  }, 10000);
});
