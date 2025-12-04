import { Rule } from "eslint";
import * as ESTree from "estree";
import { loadMessages } from "../core.js";

type NodeWithParent = ESTree.Node & { parent: NodeWithParent };

// Type definition for context options
interface NextIntlOptions {
  messagesDir?: string;
  sourceLocale?: string;
}

export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow missing translation keys",
      recommended: true,
    },
    messages: {
      missingKey: "Missing translation key: '{{key}}'",
    },
    schema: [
      {
        type: "object",
        properties: {
          messagesDir: { type: "string" },
          sourceLocale: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const settings = (context.settings?.["next-intl"] || {}) as NextIntlOptions;
    const options = (context.options[0] || {}) as NextIntlOptions;

    const messagesDir =
      options.messagesDir || settings.messagesDir || "src/messages";
    const sourceLocale = options.sourceLocale || settings.sourceLocale || "en";
    const cwd = context.cwd || process.cwd();

    let definedKeys: Set<string> | null = null;

    const getKeys = () => {
      if (!definedKeys) {
        definedKeys = loadMessages(cwd, messagesDir, sourceLocale);
      }
      return definedKeys;
    };

    return {
      VariableDeclarator(node: ESTree.Node) {
        const varNode = node as ESTree.VariableDeclarator;
        if (
          varNode.init &&
          varNode.init.type === "CallExpression" &&
          varNode.init.callee.type === "Identifier" &&
          varNode.init.callee.name === "useTranslations"
        ) {
          // Extract namespace
          let namespace = "";
          if (
            varNode.init.arguments.length > 0 &&
            varNode.init.arguments[0].type === "Literal" &&
            typeof (varNode.init.arguments[0] as ESTree.Literal).value === "string"
          ) {
            namespace = (varNode.init.arguments[0] as ESTree.Literal).value as string;
          }

          // Get declared variable 't'
          const variables = context.sourceCode.getDeclaredVariables(varNode);
          if (variables.length > 0) {
            const variable = variables[0]; // Should be the 't' variable

            // Check references
            variable.references.forEach((ref) => {
              const refNode = ref.identifier as unknown as NodeWithParent;
              // Check if it is a call expression: t(...)
              // refNode is the identifier 't'. Parent should be CallExpression
              if (
                refNode.parent &&
                refNode.parent.type === "CallExpression" &&
                (refNode.parent as unknown as ESTree.CallExpression).callee === (refNode as unknown as ESTree.Identifier)
              ) {
                // It is a call t(...)
                const callExpr = refNode.parent as unknown as ESTree.CallExpression;
                const args = callExpr.arguments;
                if (
                  args.length > 0 &&
                  args[0].type === "Literal" &&
                  typeof (args[0] as ESTree.Literal).value === "string"
                ) {
                  const key = (args[0] as ESTree.Literal).value as string;
                  const fullKey = namespace ? `${namespace}.${key}` : key;

                  const keys = getKeys();
                  if (!keys.has(fullKey)) {
                    context.report({
                      node: args[0],
                      messageId: "missingKey",
                      data: {
                        key: fullKey,
                      },
                    });
                  }
                }
              }
            });
          }
        }
      },
    };
  },
};
