import { Rule } from "eslint";
import * as ESTree from "estree";

type NodeWithParent = ESTree.Node & { parent: NodeWithParent };

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
      VariableDeclarator(node: ESTree.Node) {
        const varNode = node as ESTree.VariableDeclarator;
        if (
          varNode.init &&
          varNode.init.type === "CallExpression" &&
          varNode.init.callee.type === "Identifier" &&
          varNode.init.callee.name === "useTranslations"
        ) {
          const variables = context.sourceCode.getDeclaredVariables(varNode);
          if (variables.length > 0) {
            const variable = variables[0];
            variable.references.forEach((ref) => {
              const refNode = ref.identifier as unknown as NodeWithParent;
              if (
                refNode.parent &&
                refNode.parent.type === "CallExpression" &&
                (refNode.parent as unknown as ESTree.CallExpression).callee === (refNode as unknown as ESTree.Identifier)
              ) {
                const callExpr = refNode.parent as unknown as ESTree.CallExpression;
                const args = callExpr.arguments;
                if (args.length > 0) {
                  const arg = args[0];
                  // Warn if not a simple string literal
                  if (arg.type !== "Literal" || typeof (arg as ESTree.Literal).value !== "string") {
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
