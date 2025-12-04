# ESLint Plugin & CLI for Next-Intl

## Goal
Refactor the existing `check-messages.ts` script into a dual-purpose package:
1.  **ESLint Plugin**: Provides real-time linting for missing or dynamic translation keys in editors.
2.  **CLI Tool**: Retains the global analysis capabilities (detecting unused keys across the project) and the "fix" capability (removing unused keys from JSON files).

## Architecture

```
eslint-plugin-next-intl/
  src/
    core.ts         # Shared logic (Message loading, key validation, caching)
    cli.ts          # CLI entry point (Global analysis, Unused key detection, Fix mode)
    index.ts        # ESLint Plugin entry point
    rules/
      no-missing-keys.ts   # Rule: Errors on keys missing in the source message file
      no-dynamic-keys.ts   # Rule: Warns on dynamic keys
  tests/
    ...
  eslint.config.mjs # Config for linting this project itself (using eslint-plugin-eslint-plugin)
  package.json
  tsconfig.json
```

## Configuration & Options
The plugin and CLI must not hardcode paths or locales. They will accept the following configuration:
-   `messagesDir`: Path to the directory containing message files (default: `src/messages`).
-   `sourceLocale`: The locale used as the source of truth (default: `en`).

### ESLint Rule Configuration
Consumers will configure the rules in their `eslint.config.mjs` like so:

```javascript
// user's eslint config
rules: {
  "next-intl/no-missing-keys": ["error", { messagesDir: "src/i18n", sourceLocale: "de" }],
  "next-intl/no-dynamic-keys": "warn"
}
```

## Core Logic (`src/core.ts`)
-   **Message Loading**: Logic to resolve the absolute path of the source message file based on `cwd`, `messagesDir`, and `sourceLocale`.
-   **Key Management**: Helper to flatten JSON into dot-notation keys.
-   **Caching**: Cache loaded keys to prevent disk I/O on every single lint pass, keyed by the message file path and modification time.
-   **Exports**: `loadMessages(dir, locale)`, `flattenKeys`, `isValidKey`.

## CLI (`src/cli.ts`)
-   **Logic**: Port `check-messages.ts`.
-   **Arguments**:
    -   `--dir`: Path to message directory (default: `src/messages`).
    -   `--locale`: Source locale (default: `en`).
    -   `--check`: Report unused/missing.
    -   `--fix`: Remove unused keys.
-   **Refactoring**: Update `check-messages.ts` logic to use the configurable paths.

## ESLint Rules (`src/rules/`)
Using standard **ESTree** traversal.

### `no-missing-keys`
-   **Options**: `{ messagesDir: string, sourceLocale: string }`
-   **Logic**:
    -   Reads options to locate the JSON file.
    -   Uses `core.ts` to load valid keys.
    -   Checks `t('key')` calls against valid keys.

### `no-dynamic-keys`
-   **Logic**: Warns when `t()` is called with a non-string literal.

## Development Setup (This Repo)
-   **Dependencies**: `eslint`, `typescript`, `ts-morph`, `glob`.
-   **Dev Dependencies**: `eslint-plugin-eslint-plugin` (to lint the plugin rules themselves).
-   **Self-Linting**: Create `eslint.config.mjs` for this project:
    ```javascript
    import eslintPlugin from 'eslint-plugin-eslint-plugin';
    export default [
      eslintPlugin.configs.recommended,
      {
        rules: {
           'eslint-plugin/require-meta-docs-description': 'error',
        },
      },
    ];
    ```

## Implementation Steps
1.  **Scaffold Project**: Initialize `package.json`, `tsconfig.json`.
2.  **Install Dev Tools**: Install `eslint`, `eslint-plugin-eslint-plugin`, and configure `eslint.config.mjs`.
3.  **Extract Core**: Create `src/core.ts` with configurable message loading.
4.  **Implement CLI**: Port `check-messages.ts` to `src/cli.ts`, adding argument parsing for directory and locale.
5.  **Implement ESLint Plugin**:
    -   Create `src/index.ts`.
    -   Implement `src/rules/no-missing-keys.ts` handling rule options.
    -   Implement `src/rules/no-dynamic-keys.ts`.
6.  **Tests**: Add tests covering custom configuration scenarios.

## Completed Implementation Notes (Dec 2025)

The project has been fully implemented with the following enhancements:

### 1. Global Configuration via `settings`
While the original plan proposed rule-level options, we identified that configuring the message directory and locale for every single rule is redundant. We added support for ESLint shared settings:

```javascript
// eslint.config.mjs
export default [
  {
    settings: {
      "next-intl": {
        messagesDir: "src/i18n",
        sourceLocale: "de"
      }
    }
  }
];
```
**Reasoning**: This allows a project to define its structure once, and all `next-intl` rules (present and future) will respect it. Rule-level options were retained as an override mechanism for flexibility.

### 2. Hybrid Architecture (CLI + Plugin)
We retained the CLI (`src/cli.ts`) alongside the plugin.
**Reasoning**: ESLint is designed to be stateless and file-scoped. It cannot efficiently determine if a translation key is *unused* across the entire codebase without a massive performance penalty.
-   **ESLint**: Fast, local checks. Prevents *breaking* changes (missing keys).
-   **CLI**: Global analysis using `ts-morph`. Handles *maintenance* tasks (finding/removing unused keys).

### 3. Core Library Abstraction
`src/core.ts` abstracts the message loading and caching logic.
**Reasoning**: Both the CLI and the ESLint plugin need to read `en.json`. By centralizing this, we ensure consistent behavior (e.g., how keys are flattened) and performance (caching file reads based on mtime) for the ESLint plugin which runs frequently.
