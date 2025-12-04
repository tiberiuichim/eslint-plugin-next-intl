# eslint-plugin-next-intl

ESLint plugin and CLI tool for validatng `next-intl` translation keys.

## Features

- **ESLint Plugin**:
  - `next-intl/no-missing-keys`: Error when using a key that doesn't exist in your source message file (e.g. `en.json`).
  - `next-intl/no-dynamic-keys`: Warning when using dynamic keys (variables) which cannot be statically analyzed.
- **CLI Tool**:
  - Finds unused translation keys across your project.
  - Automatically removes unused keys from your message files.

## Installation

```bash
npm install eslint-plugin-next-intl --save-dev
```

## Usage (ESLint)

Add the plugin to your ESLint configuration.

### Flat Config (ESLint 9+)

```javascript
// eslint.config.mjs
import nextIntlPlugin from "eslint-plugin-next-intl";

export default [
  {
    plugins: {
      "next-intl": nextIntlPlugin,
    },
    rules: {
      "next-intl/no-missing-keys": "error",
      "next-intl/no-dynamic-keys": "warn",
    },
  },
];
```

### Legacy Config (.eslintrc)

```json
{
  "plugins": ["next-intl"],
  "rules": {
    "next-intl/no-missing-keys": "error",
    "next-intl/no-dynamic-keys": "warn"
  }
}
```

### Configuration

You can configure the path to your messages and the source locale globally using `settings` (recommended) or in the rule options.

#### Global Settings (Recommended)

**Flat Config:**

```javascript
export default [
  {
    // ...
    settings: {
      "next-intl": {
        messagesDir: "src/i18n",
        sourceLocale: "de",
      },
    },
  },
];
```

**Legacy Config:**

```json
{
  "settings": {
    "next-intl": {
      "messagesDir": "src/i18n",
      "sourceLocale": "de"
    }
  }
}
```

#### Rule-level Options

Alternatively, you can pass options directly to the rule (overrides global settings):

```javascript
"next-intl/no-missing-keys": ["error", {
  "messagesDir": "src/i18n",
  "sourceLocale": "de"
}]
```

- `messagesDir`: Path to the directory containing your message JSON files (default: `src/messages`).
- `sourceLocale`: The filename of your source of truth (default: `en`).

## Usage (CLI)

The CLI tool helps you find and remove unused keys.

```bash
npx next-intl-lint --help
```

### Commands

- **Check for issues**:
  ```bash
  npx next-intl-lint
  ```
- **Fix (Remove unused keys)**:
  ```bash
  npx next-intl-lint --fix
  ```
- **Custom directory/locale**:
  ```bash
  npx next-intl-lint --dir src/i18n --locale de
  ```

## License

MIT

## Credits

Created by Tiberiu Ichim.
Based on the original script by [Alba Silvente](https://github.com/dawntraoz).
