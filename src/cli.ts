#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { glob } from "glob";
import {
  Project,
  SyntaxKind,
  Node,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from "ts-morph";
import { loadMessages } from "./core.js";

// Helper to delete a key from the nested object
function deleteKey(obj: Record<string, unknown>, pathParts: string[]) {
  const key = pathParts[0];
  if (pathParts.length === 1) {
    delete obj[key];
    return Object.keys(obj).length === 0; // Return true if parent is now empty
  }

  if (obj[key] && typeof obj[key] === "object") {
    const isEmpty = deleteKey(obj[key] as Record<string, unknown>, pathParts.slice(1));
    if (isEmpty) {
      delete obj[key];
      return Object.keys(obj).length === 0;
    }
  }
  return false;
}

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: "string", default: "src/messages" },
      locale: { type: "string", default: "en" },
      check: { type: "boolean", default: true },
      fix: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
i18n Message Checker & Fixer

Usage:
  next-intl-lint [options]

Options:
  --dir <path>      Path to messages directory (default: src/messages)
  --locale <locale> Source locale (default: en)
  --check           Check for unused and missing messages (default)
  --fix             Remove unused keys from all message files
  --help, -h        Show this help message
`);
    process.exit(0);
  }

  const messagesDir = values.dir as string;
  const sourceLocale = values.locale as string;
  const mode = values.fix ? "fix" : "check";
  const cwd = process.cwd();

  console.log(`Running in ${mode} mode...`);
  console.log(`Messages directory: ${messagesDir}`);
  console.log(`Source locale: ${sourceLocale}`);

  // 1. Load keys
  const allDefinedKeys = loadMessages(cwd, messagesDir, sourceLocale);
  console.log(
    `Found ${allDefinedKeys.size} defined keys in ${sourceLocale}.json`,
  );

  if (allDefinedKeys.size === 0) {
    console.error(
      `No keys found or file missing: ${path.join(messagesDir, sourceLocale + ".json")}`,
    );
    process.exit(1);
  }

  // 2. Analyze code
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      jsx: 2, // ReactJSX
      allowJs: true,
      baseUrl: cwd,
    },
    skipAddingFilesFromTsConfig: true,
  });

  const filePaths = await glob("src/**/*.{ts,tsx}", {
    cwd: cwd,
    absolute: true,
  });
  project.addSourceFilesAtPaths(filePaths);

  const usedKeys = new Set<string>();
  const dynamicUsages: string[] = [];

  // Helper to recursively find usages
  function findUsagesRecursive(
    varNode: Node,
    namespace: string,
    visited = new Set<Node>(),
  ) {
    if (visited.has(varNode)) return;
    visited.add(varNode);

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

      let callExprCandidate: Node | null = null;

      if (Node.isPropertyAccessExpression(parent)) {
        const maybeCall = parent.getParent();
        if (Node.isCallExpression(maybeCall)) {
          callExprCandidate = maybeCall;
        }
      }

      if (Node.isCallExpression(parent)) {
        callExprCandidate = parent;
      }

      if (callExprCandidate && Node.isCallExpression(callExprCandidate)) {
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

      if (Node.isCallExpression(parent)) {
        const args = parent.getArguments();
        const argIndex = args.indexOf(ref as unknown as Node);
        if (argIndex !== -1) {
          handleArgumentPassing(parent, argIndex, namespace, visited);
        }
      }

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
            const argIndex = args.indexOf(objLiteral as unknown as Node);
            if (argIndex !== -1) {
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
    callExpr: Node,
    argIndex: number,
    namespace: string,
    visited: Set<Node>,
    destructuredPropName?: string,
  ) {
    if (!Node.isCallExpression(callExpr)) return;
    const expression = callExpr.getExpression();
    const symbol = expression.getSymbol();

    if (symbol) {
      let targetSymbol = symbol;
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
        } else if (Node.isVariableDeclaration(decl)) {
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
    const importDecl = sourceFile.getImportDeclaration(
      (decl) => decl.getModuleSpecifierValue() === "next-intl",
    );

    if (!importDecl) continue;

    const namedImports = importDecl.getNamedImports();
    const useTranslationsImport = namedImports.find(
      (ni) => ni.getName() === "useTranslations",
    );

    if (!useTranslationsImport) continue;

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
    // In original script, there was logic: "default" namespace issue?
    // If I used `useTranslations('common')` -> `common.title`.
    // If `en.json` has `common: { title: ... }`, it matches.

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
      `\n[ERROR] Found ${missingKeys.size} missing messages (used in code but not in ${sourceLocale}.json):`,
    );
    const sortedMissing = Array.from(missingKeys).sort();
    sortedMissing.forEach((k) => console.error(`  - ${k}`));
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
      const absoluteMessagesDir = path.resolve(cwd, messagesDir);

      if (fs.existsSync(absoluteMessagesDir)) {
        const messageFiles = fs
          .readdirSync(absoluteMessagesDir)
          .filter((f) => f.endsWith(".json"));

        for (const file of messageFiles) {
          const filePath = path.join(absoluteMessagesDir, file);
          console.log(`Processing ${file}...`);

          try {
            const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

            for (const keyToRemove of sortedUnused) {
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
      }
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
