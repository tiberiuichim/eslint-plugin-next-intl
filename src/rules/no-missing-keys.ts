import { Rule } from "eslint";
import { loadMessages } from "../core.js";

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
    
    const messagesDir = options.messagesDir || settings.messagesDir || "src/messages";
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
      VariableDeclarator(node: any) {
        if (
          node.init &&
          node.init.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          node.init.callee.name === "useTranslations"
        ) {
          // Extract namespace
          let namespace = "";
          if (
            node.init.arguments.length > 0 &&
            node.init.arguments[0].type === "Literal" &&
            typeof node.init.arguments[0].value === "string"
          ) {
            namespace = node.init.arguments[0].value;
          }

          // Get declared variable 't'
          const variables = context.sourceCode.getDeclaredVariables(node);
          if (variables.length > 0) {
            const variable = variables[0]; // Should be the 't' variable
            
            // Check references
            variable.references.forEach((ref) => {
               const refNode = ref.identifier as any;
               // Check if it is a call expression: t(...)
               // refNode is the identifier 't'. Parent should be CallExpression
               if (
                 refNode.parent &&
                 refNode.parent.type === "CallExpression" &&
                 refNode.parent.callee === refNode
               ) {
                 // It is a call t(...)
                 const args = refNode.parent.arguments;
                 if (args.length > 0 && args[0].type === "Literal" && typeof args[0].value === "string") {
                   const key = args[0].value;
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
