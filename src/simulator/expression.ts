import type {
  Expression,
  JsonValue,
  ValueExpr,
} from "../domain/types.js";

export interface EvaluationContext {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPath(root: unknown, path: string): unknown {
  if (path.length === 0) {
    return root;
  }

  return path.split(".").reduce<unknown>((current, segment) => {
    if (isRecord(current)) {
      return current[segment];
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }

    return undefined;
  }, root);
}

export function resolveValue(
  expression: ValueExpr,
  context: EvaluationContext,
): unknown {
  return expression.kind === "literal"
    ? expression.value
    : readPath(context, expression.path);
}

function compareOrdered(
  left: unknown,
  right: unknown,
  compare: (a: number | string, b: number | string) => boolean,
): boolean {
  if (
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "string" && typeof right === "string")
  ) {
    return compare(left, right);
  }

  return false;
}

export function evaluateExpression(
  expression: Expression,
  context: EvaluationContext,
): boolean {
  switch (expression.op) {
    case "all":
      return expression.args.every((item) =>
        evaluateExpression(item, context),
      );
    case "any":
      return expression.args.some((item) =>
        evaluateExpression(item, context),
      );
    case "not":
      return !evaluateExpression(expression.arg, context);
    case "exists":
      return resolveValue(expression.left, context) !== undefined;
    case "eq":
      return (
        resolveValue(expression.left, context) ===
        resolveValueRequired(expression.right, context)
      );
    case "neq":
      return (
        resolveValue(expression.left, context) !==
        resolveValueRequired(expression.right, context)
      );
    case "lt":
      return compareOrdered(
        resolveValue(expression.left, context),
        resolveValueRequired(expression.right, context),
        (left, right) => left < right,
      );
    case "lte":
      return compareOrdered(
        resolveValue(expression.left, context),
        resolveValueRequired(expression.right, context),
        (left, right) => left <= right,
      );
    case "gt":
      return compareOrdered(
        resolveValue(expression.left, context),
        resolveValueRequired(expression.right, context),
        (left, right) => left > right,
      );
    case "gte":
      return compareOrdered(
        resolveValue(expression.left, context),
        resolveValueRequired(expression.right, context),
        (left, right) => left >= right,
      );
    case "in": {
      const left = resolveValue(expression.left, context);
      const right = resolveValueRequired(expression.right, context);
      return Array.isArray(right) && right.includes(left as never);
    }
  }
}

function resolveValueRequired(
  expression: ValueExpr | undefined,
  context: EvaluationContext,
): unknown {
  if (!expression) {
    throw new Error("Comparison expression is missing its right operand.");
  }

  return resolveValue(expression, context);
}

export function resolveArgs(
  args: Record<string, ValueExpr>,
  context: EvaluationContext,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(args).map(([key, expression]) => {
      const value = resolveValue(expression, context);
      if (value === undefined) {
        throw new Error(`Workflow argument ${key} resolved to undefined.`);
      }
      return [key, value as JsonValue];
    }),
  );
}

