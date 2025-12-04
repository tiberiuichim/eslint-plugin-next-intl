import { Rule } from "eslint";

export const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "disallow dynamic translation keys",
      recommended: true,
    },
    messages: {
      dynamicKey: "Dynamic keys cannot be statically analyzed.",
    },
    schema: [],
  },
  create(context) {
    return {
      VariableDeclarator(node: any) {
        if (
          node.init &&
          node.init.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          node.init.callee.name === "useTranslations"
        ) {
          const variables = context.sourceCode.getDeclaredVariables(node);
          if (variables.length > 0) {
            const variable = variables[0];
            variable.references.forEach((ref) => {
               const refNode = ref.identifier as any;
               if (
                 refNode.parent &&
                 refNode.parent.type === "CallExpression" &&
                 refNode.parent.callee === refNode
               ) {
                 const args = refNode.parent.arguments;
                 if (args.length > 0) {
                   const arg = args[0];
                   // Warn if not a simple string literal
                   if (arg.type !== "Literal" || typeof arg.value !== "string") {
                     context.report({
                       node: arg,
                       messageId: "dynamicKey",
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
