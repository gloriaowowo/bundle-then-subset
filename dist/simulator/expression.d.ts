import type { Expression, JsonValue, ValueExpr } from "../domain/types.js";
export interface EvaluationContext {
    [key: string]: unknown;
}
export declare function readPath(root: unknown, path: string): unknown;
export declare function resolveValue(expression: ValueExpr, context: EvaluationContext): unknown;
export declare function evaluateExpression(expression: Expression, context: EvaluationContext): boolean;
export declare function resolveArgs(args: Record<string, ValueExpr>, context: EvaluationContext): Record<string, JsonValue>;
