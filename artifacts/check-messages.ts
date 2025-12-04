/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * i18n Message Checker Script
 *
 * This script scans the codebase for usages of `next-intl`'s `useTranslations` hook and compares the found keys
 * against the `src/messages/en.json` file.
 *
 * Capabilities:
 * - Detects UNUSED messages: Keys present in `en.json` but not found in the code.
 * - Detects MISSING messages: Keys found in the code but missing from `en.json`.
 * - Detects DYNAMIC usage: Warns about dynamic keys that cannot be statically analyzed.
 * - Auto-fix: Can automatically remove unused keys from all message files.
 *
 * Usage:
 *   npx tsx dev-scripts/check-messages.ts [options]
 *
 * Options:
 *   --check   Check for unused and missing messages (default).
 *   --fix     Remove unused keys from all message files.
 *   --help    Show this help message.
 */

import fs from "fs";
import path from "path";

import { glob } from "glob";
import {
  Project,
  SyntaxKind,
  Node,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from "ts-morph";

const MESSAGES_DIR = path.join(process.cwd(), "src/messages");

// Helper to flatten the JSON object into dot-notation keys
function flattenKeys(obj: any, prefix = ""): string[] {
  let keys: string[] = [];
  for (const key in obj) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      keys = keys.concat(
        flattenKeys(obj[key], prefix ? `${prefix}.${key}` : key),
      );
    } else {
      keys.push(prefix ? `${prefix}.${key}` : key);
    }
  }
  return keys;
}

// Helper to delete a key from the nested object
function deleteKey(obj: any, pathParts: string[]) {
  const key = pathParts[0];
  if (pathParts.length === 1) {
    delete obj[key];
    return Object.keys(obj).length === 0; // Return true if parent is now empty
  }

  if (obj[key]) {
    const isEmpty = deleteKey(obj[key], pathParts.slice(1));
    if (isEmpty) {
      delete obj[key];
      return Object.keys(obj).length === 0;
    }
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
i18n Message Checker

Usage:
  npx tsx dev-scripts/check-messages.ts [options]

Options:
  --check     Check for unused and missing messages (default).
  --fix       Remove unused keys from all message files (e.g. en.json, ro.json).
  --help, -h  Show this help message.

Description:
  This tool analyzes your TypeScript/React code to find usages of 'useTranslations'
  and compares them against the keys defined in 'src/messages/en.json'.

  It reports:
  1. Unused keys (defined in JSON but never used in code)
  2. Missing keys (used in code but not defined in JSON)
  3. Dynamic usages (warnings for non-static keys)
    `);
    process.exit(0);
  }

  const mode = args.includes("--fix") ? "fix" : "report";

  console.log(`Running in ${mode === "fix" ? "fix" : "check"} mode...`);

  // 1. Load and parse message files
  // We use 'en.json' as the source of truth for structure
  const enPath = path.join(MESSAGES_DIR, "en.json");
  if (!fs.existsSync(enPath)) {
    console.error(`Messages file not found at ${enPath}`);
    process.exit(1);
  }

  const enContent = JSON.parse(fs.readFileSync(enPath, "utf-8"));
  const allDefinedKeys = new Set(flattenKeys(enContent));

  console.log(`Found ${allDefinedKeys.size} defined keys in en.json`);

  // 2. Analyze code
  // Initialize project without reading tsconfig.json to avoid scanning restricted directories (like postgres_data)
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      jsx: 2, // ReactJSX
      allowJs: true,
      baseUrl: process.cwd(),
      paths: {
        "@/drizzle-tsdb/*": ["./drizzle-tsdb/*"],
        "@/*": ["./src/*"],
      },
    },
    skipAddingFilesFromTsConfig: true,
  });

  const filePaths = await glob("src/**/*.{ts,tsx}", {
    cwd: process.cwd(),
    absolute: true,
  });
  project.addSourceFilesAtPaths(filePaths);

  const usedKeys = new Set<string>();
  const dynamicUsages: string[] = [];

  // Helper to recursively find usages of a variable (or parameter) that holds the translation function
  function findUsagesRecursive(
    varNode: Node,
    namespace: string,
    visited = new Set<Node>(),
  ) {
    if (visited.has(varNode)) return;
    visited.add(varNode);

    // Check if the node is one that can be referenced (Variable, Parameter, BindingElement)
    if (
      !Node.isVariableDeclaration(varNode) &&
      !Node.isParameterDeclaration(varNode) &&
      !Node.isBindingElement(varNode)
    ) {
      return;
    }

    const references = varNode.findReferencesAsNodes();

    for (const ref of references) {
      const parent = ref.getParent();
      if (!parent) continue;

      // Case 1: Direct call t("key")
      let callExprCandidate = null;

      if (Node.isPropertyAccessExpression(parent)) {
        const maybeCall = parent.getParent();
        if (Node.isCallExpression(maybeCall)) {
          callExprCandidate = maybeCall;
        }
      }

      if (Node.isCallExpression(parent)) {
        callExprCandidate = parent;
      }

      if (callExprCandidate) {
        const expr = callExprCandidate.getExpression();

        const isDirect = expr === ref;
        const isRich =
          Node.isPropertyAccessExpression(expr) && expr.getExpression() === ref;

        if (isDirect || isRich) {
          const args = callExprCandidate.getArguments();
          if (args.length > 0 && Node.isStringLiteral(args[0])) {
            const fullKey = namespace
              ? `${namespace}.${args[0].getLiteralValue()}`
              : args[0].getLiteralValue();
            usedKeys.add(fullKey);
          } else {
            dynamicUsages.push(
              `${varNode.getSourceFile().getFilePath()}: t() called with dynamic key for namespace '${namespace}'`,
            );
          }
          continue;
        }
      }
      // Case 2: Passed as argument to another function call: func(t)
      if (Node.isCallExpression(parent)) {
        // Check if ref is an argument
        const args = parent.getArguments();
        const argIndex = args.indexOf(ref as any);
        if (argIndex !== -1) {
          handleArgumentPassing(parent, argIndex, namespace, visited);
        }
      }

      // Case 3: Passed as property in object argument: func({ t })
      // ref -> ShorthandPropertyAssignment or PropertyAssignment -> ObjectLiteralExpression -> CallExpression
      if (
        (Node.isShorthandPropertyAssignment(parent) ||
          Node.isPropertyAssignment(parent)) &&
        (parent.getName() === "t" || parent.getInitializer() === ref)
      ) {
        const objLiteral = parent.getParent();
        if (Node.isObjectLiteralExpression(objLiteral)) {
          const callExpr = objLiteral.getParent();
          if (Node.isCallExpression(callExpr)) {
            const args = callExpr.getArguments();
            const argIndex = args.indexOf(objLiteral as any);
            if (argIndex !== -1) {
              // We need to find the function definition and look for destructuring of 't' (or the property name)
              const propName = parent.getName();
              handleArgumentPassing(
                callExpr,
                argIndex,
                namespace,
                visited,
                propName,
              );
            }
          }
        }
      }
    }
  }

  function handleArgumentPassing(
    callExpr: any,
    argIndex: number,
    namespace: string,
    visited: Set<Node>,
    destructuredPropName?: string,
  ) {
    const expression = callExpr.getExpression();
    const symbol = expression.getSymbol();

    if (symbol) {
      let targetSymbol = symbol;

      // Check if the symbol is an import specifier (alias) and resolve it
      const decls = symbol.getDeclarations();
      if (decls.length > 0 && Node.isImportSpecifier(decls[0])) {
        const aliased = symbol.getAliasedSymbol();
        if (aliased) {
          targetSymbol = aliased;
        }
      }

      const declarations = targetSymbol.getDeclarations();

      if (declarations && declarations.length > 0) {
        const decl = declarations[0];

        if (
          Node.isFunctionDeclaration(decl) ||
          Node.isArrowFunction(decl) ||
          Node.isMethodDeclaration(decl) ||
          Node.isFunctionExpression(decl)
        ) {
          const params = decl.getParameters();
          if (argIndex < params.length) {
            const param = params[argIndex];

            if (destructuredPropName) {
              // Look for destructuring
              const nameNode = param.getNameNode();
              if (Node.isObjectBindingPattern(nameNode)) {
                for (const element of nameNode.getElements()) {
                  // Check if element binds the property we passed
                  // e.g. { t } or { t: myT }
                  const propertyName =
                    element.getPropertyNameNode()?.getText() ||
                    element.getName();
                  if (propertyName === destructuredPropName) {
                    findUsagesRecursive(element, namespace, visited);
                  }
                }
              }
            } else {
              // Direct passing
              findUsagesRecursive(param, namespace, visited);
            }
          }
        }
        // Handle variable declaration that holds an arrow function
        else if (Node.isVariableDeclaration(decl)) {
          const initializer = decl.getInitializer();
          if (
            initializer &&
            (Node.isArrowFunction(initializer) ||
              Node.isFunctionExpression(initializer))
          ) {
            const params = initializer.getParameters();
            if (argIndex < params.length) {
              const param = params[argIndex];
              if (destructuredPropName) {
                const nameNode = param.getNameNode();
                if (Node.isObjectBindingPattern(nameNode)) {
                  for (const element of nameNode.getElements()) {
                    const propertyName =
                      element.getPropertyNameNode()?.getText() ||
                      element.getName();
                    if (propertyName === destructuredPropName) {
                      findUsagesRecursive(element, namespace, visited);
                    }
                  }
                }
              } else {
                findUsagesRecursive(param, namespace, visited);
              }
            }
          }
        }
      }
    }
  }

  for (const sourceFile of project.getSourceFiles()) {
    // Find all imports of useTranslations
    const importDecl = sourceFile.getImportDeclaration(
      (decl) => decl.getModuleSpecifierValue() === "next-intl",
    );

    if (!importDecl) continue;

    const namedImports = importDecl.getNamedImports();
    const useTranslationsImport = namedImports.find(
      (ni) => ni.getName() === "useTranslations",
    );

    if (!useTranslationsImport) continue;

    // Find calls to useTranslations
    const callExpressions = sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    );

    for (const callExpr of callExpressions) {
      const expression = callExpr.getExpression();
      if (expression.getText() === "useTranslations") {
        const args = callExpr.getArguments();
        let namespace = "default";

        if (args.length > 0) {
          const arg = args[0];
          if (Node.isStringLiteral(arg)) {
            namespace = arg.getLiteralValue();
          } else {
            dynamicUsages.push(
              `${sourceFile.getFilePath()}: useTranslations called with dynamic namespace`,
            );
            continue;
          }
        }

        // Find the variable name this is assigned to
        const varDecl = callExpr.getParentIfKind(
          SyntaxKind.VariableDeclaration,
        );
        if (varDecl) {
          findUsagesRecursive(varDecl, namespace);
        }
      }
    }
  }

  console.log(`Found ${usedKeys.size} unique used keys in code.`);

  // 3. Compare and Report
  const unusedKeys = new Set<string>();
  const missingKeys = new Set<string>();

  for (const definedKey of allDefinedKeys) {
    if (!usedKeys.has(definedKey)) {
      unusedKeys.add(definedKey);
    }
  }

  for (const usedKey of usedKeys) {
    if (!allDefinedKeys.has(usedKey)) {
      missingKeys.add(usedKey);
    }
  }

  console.log("\n--- Analysis Report ---");

  let hasIssues = false;

  if (dynamicUsages.length > 0) {
    console.warn(
      `\n[WARN] Found ${dynamicUsages.length} dynamic usages which cannot be statically analyzed:`,
    );
    dynamicUsages.slice(0, 10).forEach((u) => console.warn(`  - ${u}`));
    if (dynamicUsages.length > 10)
      console.warn(`  ... and ${dynamicUsages.length - 10} more.`);
    console.warn("Be careful removing keys if they might be used dynamically.");
  }

  if (missingKeys.size > 0) {
    console.error(
      `\n[ERROR] Found ${missingKeys.size} missing messages (used in code but not in en.json):`,
    );
    const sortedMissing = Array.from(missingKeys).sort();
    sortedMissing.forEach((k) => console.error(`  - ${k}`));
    // We exit with error if there are missing keys, as this breaks the app
    process.exitCode = 1;
    hasIssues = true;
  } else {
    console.log("\n[OK] No missing messages found.");
  }

  if (unusedKeys.size === 0) {
    console.log("\n[OK] No unused messages found.");
  } else {
    console.log(`\n[INFO] Found ${unusedKeys.size} unused messages:`);
    const sortedUnused = Array.from(unusedKeys).sort();
    sortedUnused.forEach((k) => console.log(`  - ${k}`));

    if (mode === "fix") {
      console.log("\nFixing... removing unused keys from message files.");

      // Process all json files in messages dir
      const messageFiles = fs
        .readdirSync(MESSAGES_DIR)
        .filter((f) => f.endsWith(".json"));

      for (const file of messageFiles) {
        const filePath = path.join(MESSAGES_DIR, file);
        console.log(`Processing ${file}...`);

        try {
          const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

          for (const keyToRemove of sortedUnused) {
            // Only attempt to remove if it matches the structure of en.json
            // (We assume keys are symmetric across languages)
            const parts = keyToRemove.split(".");
            if (deleteKey(content, parts)) {
              // returns true if parent became empty
            }
          }

          fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n");
          console.log(`  Updated ${file}`);
        } catch (e) {
          console.error(`  Error processing ${file}:`, e);
        }
      }
      console.log("\nDone.");
    } else {
      console.log("\nRun with --fix to remove these keys.");
    }
  }

  if (process.exitCode === 1) {
    console.log("\nCheck failed. Please address the errors above.");
  } else if (!hasIssues && unusedKeys.size === 0) {
    console.log("\nAll checks passed! Great job.");
  }
}

main().catch(console.error);
