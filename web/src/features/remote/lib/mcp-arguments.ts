import { isRecord } from "@/features/remote/lib/json-guards";

export type McpFieldKind = "string" | "number" | "integer" | "boolean" | "enum" | "json";

export type McpField = {
  name: string;
  kind: McpFieldKind;
  required: boolean;
  description?: string;
  options?: string[];
};

export type McpArgumentsResult =
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; field: string; problem: "required" | "number" | "integer" | "json" };

function fieldKind(schema: Record<string, unknown>): McpFieldKind {
  if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === "string")) {
    return "enum";
  }
  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== "null")
    : schema.type;
  if (type === "string" || type === "number" || type === "integer" || type === "boolean") {
    return type;
  }
  return "json";
}

/** Form fields for a tool's JSON Schema `properties` (non-scalar values are edited as JSON). */
export function mcpFields(inputSchema: Record<string, unknown> | undefined): McpField[] {
  const properties = isRecord(inputSchema?.properties) ? inputSchema.properties : {};
  const required = new Set(
    Array.isArray(inputSchema?.required)
      ? inputSchema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  return Object.entries(properties)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([name, schema]) => {
      const kind = fieldKind(schema);
      return {
        name,
        kind,
        required: required.has(name),
        description: typeof schema.description === "string" ? schema.description : undefined,
        options:
          kind === "enum" && Array.isArray(schema.enum)
            ? schema.enum.filter((item): item is string => typeof item === "string")
            : undefined,
      };
    })
    .sort((a, b) => Number(b.required) - Number(a.required));
}

/**
 * Build `tools/call` arguments from form values. Empty optional fields are omitted; numbers and
 * JSON are parsed, and the first invalid field is reported instead of sending a guess.
 */
export function buildMcpArguments(
  fields: readonly McpField[],
  values: Readonly<Record<string, string | boolean>>,
): McpArgumentsResult {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.kind === "boolean") {
      if (typeof value === "boolean") output[field.name] = value;
      else if (field.required) output[field.name] = false;
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (field.required) return { ok: false, field: field.name, problem: "required" };
      continue;
    }
    if (field.kind === "number" || field.kind === "integer") {
      const number = Number(text);
      if (!Number.isFinite(number)) return { ok: false, field: field.name, problem: "number" };
      if (field.kind === "integer" && !Number.isInteger(number)) {
        return { ok: false, field: field.name, problem: "integer" };
      }
      output[field.name] = number;
    } else if (field.kind === "json") {
      try {
        output[field.name] = JSON.parse(text);
      } catch {
        return { ok: false, field: field.name, problem: "json" };
      }
    } else {
      output[field.name] = typeof value === "string" ? value : text;
    }
  }
  return { ok: true, arguments: output };
}
