/**
 * YAML value model with the scalar resolution rules of `serde_yaml` 0.9, the
 * parser the Relay uses for workflow definitions. Browser validation must
 * accept and reject exactly what the Relay does, so the rules here follow
 * serde_yaml's `de.rs` (`visit_untagged_scalar`, `parse_unsigned_int`,
 * `parse_negative_int`, `parse_f64`, `deserialize_option`) rather than the
 * YAML library's own type resolution.
 */
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  type Node,
  parseAllDocuments,
  Scalar,
} from "yaml";

export type YamlValue =
  | { kind: "scalar"; text: string; plain: boolean; explicitString: boolean; line: number }
  | { kind: "seq"; items: YamlValue[]; line: number }
  | { kind: "map"; entries: Array<[YamlValue, YamlValue]>; line: number };

export type YamlScalar = Extract<YamlValue, { kind: "scalar" }>;

/** serde's dynamic `Content` classification of a value (`deserialize_any`). */
export type ContentKind = "unit" | "bool" | "integer" | "float" | "string" | "sequence" | "map";

export type YamlDocumentResult =
  | { ok: true; root: YamlValue | null }
  | { ok: false; reason: "syntax"; detail: string; line: number | null }
  | { ok: false; reason: "multiple_documents" };

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const I128_MIN = -(1n << 127n);
const RADIX_DIGITS: Record<number, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
  16: /^[0-9a-fA-F]+$/,
};
const RADIX_PREFIX: Record<number, string> = { 2: "0b", 8: "0o", 10: "", 16: "0x" };
const NULL_FORMS: Record<string, true> = { null: true, Null: true, NULL: true, "~": true };
const BOOL_FORMS: Record<string, boolean> = {
  true: true,
  True: true,
  TRUE: true,
  false: false,
  False: false,
  FALSE: false,
};

/** Parse the whole editor text the way `serde_yaml::from_str` sees it. */
export function parseYamlDocument(source: string): YamlDocumentResult {
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(source, { lineCounter, uniqueKeys: false });
  const list = Array.isArray(documents) ? documents : [];
  if (list.length > 1) return { ok: false, reason: "multiple_documents" };
  const document = list[0];
  if (!document) return { ok: true, root: null };
  const failure = document.errors[0];
  if (failure) {
    return {
      ok: false,
      reason: "syntax",
      detail: failure.message.split("\n")[0] ?? failure.code,
      line: failure.linePos?.[0]?.line ?? null,
    };
  }
  const lineOf = (node: Node | null | undefined): number =>
    node?.range ? lineCounter.linePos(node.range[0]).line : 1;
  let unresolvedAlias: number | null = null;

  function convert(node: unknown, depth: number): YamlValue {
    if (depth > 64) throw new Error("depth");
    if (isAlias(node)) {
      const target = node.resolve(document);
      if (!target) {
        unresolvedAlias ??= lineOf(node);
        return { kind: "scalar", text: "", plain: true, explicitString: false, line: lineOf(node) };
      }
      return convert(target, depth + 1);
    }
    if (isMap(node)) {
      return {
        kind: "map",
        line: lineOf(node),
        entries: node.items.map((pair) => [
          convert(pair.key ?? new Scalar(null), depth + 1),
          convert(pair.value ?? new Scalar(null), depth + 1),
        ]),
      };
    }
    if (isSeq(node)) {
      return {
        kind: "seq",
        line: lineOf(node),
        items: node.items.map((item) => convert(item ?? new Scalar(null), depth + 1)),
      };
    }
    if (isScalar(node)) {
      const text = typeof node.source === "string" ? node.source : String(node.value ?? "");
      return {
        kind: "scalar",
        text,
        plain: node.type === undefined || node.type === Scalar.PLAIN,
        explicitString: node.tag === "tag:yaml.org,2002:str",
        line: lineOf(node),
      };
    }
    return { kind: "scalar", text: "", plain: true, explicitString: false, line: lineOf(null) };
  }

  try {
    const root = document.contents === null ? null : convert(document.contents, 0);
    if (unresolvedAlias !== null) {
      return { ok: false, reason: "syntax", detail: "unknown anchor", line: unresolvedAlias };
    }
    return { ok: true, root };
  } catch {
    return { ok: false, reason: "syntax", detail: "recursion limit exceeded", line: null };
  }
}

/** Rust `from_str_radix` for a digit string without sign. */
function radixValue(digits: string, radix: number): bigint | null {
  if (!RADIX_DIGITS[radix]?.test(digits)) return null;
  return BigInt(`${RADIX_PREFIX[radix]}${digits}`);
}

/** `digits_but_not_number`: leading zeros make a YAML 1.2 string, not a number. */
function digitsButNotNumber(text: string): boolean {
  const unsigned = text.startsWith("-") || text.startsWith("+") ? text.slice(1) : text;
  return unsigned.length > 1 && unsigned.startsWith("0") && /^[0-9]+$/.test(unsigned.slice(1));
}

function signLeads(text: string): boolean {
  return text.startsWith("+") || text.startsWith("-");
}

/** `parse_unsigned_int` bounded by `max` (u64 or u128). */
export function parseUnsignedInt(text: string, max: bigint = U64_MAX): bigint | null {
  const unpositive = text.startsWith("+") ? text.slice(1) : text;
  for (const [prefix, radix] of [
    ["0x", 16],
    ["0o", 8],
    ["0b", 2],
  ] as const) {
    if (!unpositive.startsWith(prefix)) continue;
    const rest = unpositive.slice(prefix.length);
    if (signLeads(rest)) return null;
    const value = radixValue(rest, radix);
    if (value !== null && value <= max) return value;
  }
  if (signLeads(unpositive) || digitsButNotNumber(text)) return null;
  const value = radixValue(unpositive, 10);
  return value !== null && value <= max ? value : null;
}

/** `parse_negative_int` bounded below by `min` (i64 or i128). */
function parseNegativeInt(text: string, min: bigint): bigint | null {
  for (const [prefix, radix] of [
    ["-0x", 16],
    ["-0o", 8],
    ["-0b", 2],
  ] as const) {
    if (!text.startsWith(prefix)) continue;
    const magnitude = radixValue(text.slice(prefix.length), radix);
    if (magnitude !== null && -magnitude >= min) return -magnitude;
  }
  if (digitsButNotNumber(text)) return null;
  const match = /^([+-]?)([0-9]+)$/.exec(text);
  if (!match) return null;
  const value = match[1] === "-" ? -BigInt(match[2] ?? "0") : BigInt(match[2] ?? "0");
  return value >= min && value <= -min - 1n ? value : null;
}

/** `parse_f64`: finite decimal floats plus the YAML `.inf`/`.nan` spellings. */
function isYamlFloat(text: string): boolean {
  let unpositive = text;
  if (text.startsWith("+")) {
    unpositive = text.slice(1);
    if (signLeads(unpositive)) return false;
  }
  if ([".inf", ".Inf", ".INF"].includes(unpositive)) return true;
  if (["-.inf", "-.Inf", "-.INF", ".nan", ".NaN", ".NAN"].includes(text)) return true;
  if (!/^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(unpositive)) return false;
  return Number.isFinite(Number(unpositive));
}

/** `visit_untagged_scalar` for plain scalars; quoted/block/`!!str` scalars are strings. */
export function scalarKind(value: YamlScalar): Exclude<ContentKind, "sequence" | "map"> {
  if (!value.plain || value.explicitString) return "string";
  const text = value.text;
  if (text === "" || NULL_FORMS[text] === true) return "unit";
  if (typeof BOOL_FORMS[text] === "boolean") return "bool";
  if (parseUnsignedInt(text, U128_MAX) !== null || parseNegativeInt(text, I128_MIN) !== null) {
    return "integer";
  }
  if (!digitsButNotNumber(text) && isYamlFloat(text)) return "float";
  return "string";
}

export function contentKind(value: YamlValue): ContentKind {
  if (value.kind === "seq") return "sequence";
  if (value.kind === "map") return "map";
  return scalarKind(value);
}

/** `deserialize_bool` on a direct (non-buffered) field: plain bool spellings only. */
export function plainBool(value: YamlValue): boolean | null {
  if (value.kind !== "scalar" || !value.plain) return null;
  const parsed = BOOL_FORMS[value.text];
  return typeof parsed === "boolean" ? parsed : null;
}

/** `deserialize_option` on a direct field: only plain, untagged null spellings are `None`. */
export function isDirectNone(value: YamlValue): boolean {
  return (
    value.kind === "scalar" &&
    value.plain &&
    !value.explicitString &&
    (value.text === "" || NULL_FORMS[value.text] === true)
  );
}
