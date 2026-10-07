import { z } from "zod";
import { LlmConfigError } from "./errors";

type JsonSchemaNode = Record<string, unknown>;

/**
 * Converts a zod schema to the JSON Schema subset accepted by OpenAI-style strict structured outputs.
 * Strict mode requires every object to list all its properties as required and to forbid extra ones: use
 * `.nullable()` instead of `.optional()`. Checked here so a schema mistake fails at the first call with a clear
 * message instead of an opaque 400 from the provider.
 * @throws {LlmConfigError} if the schema cannot be expressed in strict mode.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchemaNode {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema, { target: "draft-2020-12" });
  assertStrict(jsonSchema, "$");
  return jsonSchema;
}

function assertStrict(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertStrict(child, `${path}[${index}]`));
    return;
  }
  if (!isRecord(node)) return;
  if (node["type"] === "object") {
    const properties = isRecord(node["properties"]) ? Object.keys(node["properties"]) : [];
    const required = Array.isArray(node["required"]) ? node["required"] : [];
    const notRequired = properties.filter((key) => !required.includes(key));
    if (notRequired.length > 0) {
      throw new LlmConfigError(
        `strict schema: ${path} has optional properties (${notRequired.join(", ")}); use .nullable()`,
      );
    }
    if (node["additionalProperties"] !== false) {
      throw new LlmConfigError(`strict schema: ${path} must forbid additional properties`);
    }
  }
  for (const [key, child] of Object.entries(node)) assertStrict(child, `${path}.${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
