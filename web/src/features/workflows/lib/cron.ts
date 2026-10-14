/**
 * Cron validation mirroring the Relay's acceptance rules: `normalize_cron` in
 * crates/buzz-workflow/src/schema.rs followed by the `cron` 0.16 crate parser.
 * The grammar is a PEG (winnow); this is a faithful port of its combinators so
 * that every expression the Relay rejects is rejected here, and vice versa.
 */

type Specifier =
  | { kind: "all" }
  | { kind: "point"; value: number }
  | { kind: "range"; start: number; end: number }
  | { kind: "namedRange"; start: string; end: string };

type RootSpecifier =
  | { kind: "specifier"; specifier: Specifier }
  | { kind: "period"; start: Specifier; step: number }
  | { kind: "namedPoint"; name: string };

type Parsed<T> = { value: T; rest: string } | null;

type TimeUnit = {
  min: number;
  max: number;
  names?: Readonly<Record<string, number>>;
};

const DAYS_OF_WEEK: Readonly<Record<string, number>> = {
  sun: 1,
  sunday: 1,
  mon: 2,
  monday: 2,
  tue: 3,
  tues: 3,
  tuesday: 3,
  wed: 4,
  wednesday: 4,
  thu: 5,
  thurs: 5,
  thursday: 5,
  fri: 6,
  friday: 6,
  sat: 7,
  saturday: 7,
};

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const SECONDS: TimeUnit = { min: 0, max: 59 };
const MINUTES: TimeUnit = { min: 0, max: 59 };
const HOURS: TimeUnit = { min: 0, max: 23 };
const DAYS_OF_MONTH: TimeUnit = { min: 1, max: 31 };
const MONTH_UNIT: TimeUnit = { min: 1, max: 12, names: MONTHS };
const DAY_OF_WEEK_UNIT: TimeUnit = { min: 1, max: 7, names: DAYS_OF_WEEK };
const YEARS: TimeUnit = { min: 1970, max: 2100 };

const U32_MAX = 4_294_967_295;

/** winnow `multispace0`: spaces, tabs, carriage returns and newlines. */
function skipSpace(input: string): string {
  let index = 0;
  while (index < input.length && " \t\r\n".includes(input[index] ?? "")) index += 1;
  return input.slice(index);
}

function takeWhile(input: string, accept: (char: string) => boolean): Parsed<string> {
  let index = 0;
  while (index < input.length && accept(input[index] ?? "")) index += 1;
  return index === 0 ? null : { value: input.slice(0, index), rest: input.slice(index) };
}

function ordinal(input: string): Parsed<number> {
  const digits = takeWhile(skipSpace(input), (char) => char >= "0" && char <= "9");
  if (!digits) return null;
  const value = Number(digits.value);
  // `u32::from_str` rejects values that do not fit.
  if (!Number.isSafeInteger(value) || value > U32_MAX) return null;
  return { value, rest: skipSpace(digits.rest) };
}

function name(input: string): Parsed<string> {
  const letters = takeWhile(
    skipSpace(input),
    (char) => (char >= "a" && char <= "z") || (char >= "A" && char <= "Z"),
  );
  return letters ? { value: letters.value, rest: skipSpace(letters.rest) } : null;
}

function literal(input: string, token: string): string | null {
  return input.startsWith(token) ? input.slice(token.length) : null;
}

function range(input: string): Parsed<Specifier> {
  const start = ordinal(input);
  if (!start) return null;
  const afterDash = literal(start.rest, "-");
  if (afterDash === null) return null;
  const end = ordinal(afterDash);
  return end
    ? { value: { kind: "range", start: start.value, end: end.value }, rest: end.rest }
    : null;
}

function namedRange(input: string): Parsed<Specifier> {
  const start = name(input);
  if (!start) return null;
  const afterDash = literal(start.rest, "-");
  if (afterDash === null) return null;
  const end = name(afterDash);
  return end
    ? { value: { kind: "namedRange", start: start.value, end: end.value }, rest: end.rest }
    : null;
}

function specifier(input: string, allowAny: boolean): Parsed<Specifier> {
  if (allowAny) {
    const afterAny = literal(input, "?");
    if (afterAny !== null) return { value: { kind: "all" }, rest: afterAny };
  }
  const afterAll = literal(input, "*");
  if (afterAll !== null) return { value: { kind: "all" }, rest: afterAll };
  const parsedRange = range(input);
  if (parsedRange) return parsedRange;
  const point = ordinal(input);
  if (point) return { value: { kind: "point", value: point.value }, rest: point.rest };
  return namedRange(input);
}

function rootSpecifier(input: string, allowAny: boolean): Parsed<RootSpecifier> {
  const start = specifier(input, allowAny);
  if (start) {
    const afterSlash = literal(start.rest, "/");
    if (afterSlash !== null) {
      const step = ordinal(afterSlash);
      if (step) {
        return {
          value: { kind: "period", start: start.value, step: step.value },
          rest: step.rest,
        };
      }
    }
    return { value: { kind: "specifier", specifier: start.value }, rest: start.rest };
  }
  const named = name(input);
  return named ? { value: { kind: "namedPoint", name: named.value }, rest: named.rest } : null;
}

/** `delimited(multispace0, separated(1.., root_specifier, ","), multispace0)`. */
function field(input: string, allowAny: boolean): Parsed<RootSpecifier[]> {
  let rest = skipSpace(input);
  const first = rootSpecifier(rest, allowAny);
  if (!first) return null;
  const specifiers = [first.value];
  rest = first.rest;
  for (;;) {
    const afterComma = literal(rest, ",");
    if (afterComma === null) break;
    const next = rootSpecifier(afterComma, allowAny);
    // winnow's `separated` backtracks to before the separator when the
    // following element fails, leaving the comma unconsumed.
    if (!next) break;
    specifiers.push(next.value);
    rest = next.rest;
  }
  return { value: specifiers, rest: skipSpace(rest) };
}

function validOrdinal(unit: TimeUnit, value: number): boolean {
  return value >= unit.min && value <= unit.max;
}

function nameOrdinal(unit: TimeUnit, value: string): number | null {
  return unit.names?.[value.toLowerCase()] ?? null;
}

function specifierOrdinals(unit: TimeUnit, spec: Specifier): number[] | null {
  if (spec.kind === "all") return inclusive(unit.min, unit.max);
  if (spec.kind === "point") return [spec.value];
  const start = spec.kind === "range" ? spec.start : nameOrdinal(unit, spec.start);
  const end = spec.kind === "range" ? spec.end : nameOrdinal(unit, spec.end);
  if (start === null || end === null) return null;
  if (!validOrdinal(unit, start) || !validOrdinal(unit, end) || start > end) return null;
  return inclusive(start, end);
}

function inclusive(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

/** `TimeUnitField::from_field`: every produced ordinal must be within the unit. */
function validField(unit: TimeUnit, specifiers: readonly RootSpecifier[]): boolean {
  for (const root of specifiers) {
    let ordinals: number[] | null;
    if (root.kind === "specifier") {
      ordinals = specifierOrdinals(unit, root.specifier);
    } else if (root.kind === "namedPoint") {
      const value = nameOrdinal(unit, root.name);
      ordinals = value === null ? null : [value];
    } else {
      if (root.step < 1 || root.step > unit.max) return false;
      if (root.start.kind === "point") {
        if (!validOrdinal(unit, root.start.value)) return false;
        ordinals = [root.start.value];
      } else {
        ordinals = specifierOrdinals(unit, root.start);
      }
    }
    if (!ordinals || ordinals.some((value) => !validOrdinal(unit, value))) return false;
  }
  return true;
}

const SHORTHANDS = ["@yearly", "@monthly", "@weekly", "@daily", "@hourly"] as const;

function parsesAsSchedule(expression: string): boolean {
  const trimmedStart = skipSpace(expression);
  for (const shorthand of SHORTHANDS) {
    const rest = literal(trimmedStart, shorthand);
    if (rest !== null) return skipSpace(rest) === "";
  }

  const units = [SECONDS, MINUTES, HOURS, DAYS_OF_MONTH, MONTH_UNIT, DAY_OF_WEEK_UNIT];
  let rest = expression;
  for (const [index, unit] of units.entries()) {
    const parsed = field(rest, index === 3 || index === 5);
    if (!parsed || !validField(unit, parsed.value)) return false;
    rest = parsed.rest;
  }
  if (rest === "") return true;
  const years = field(rest, false);
  return Boolean(years && validField(YEARS, years.value) && years.rest === "");
}

/** `normalize_cron`: 5 fields gain seconds and year, 6 fields gain year. */
export function normalizeCron(expression: string): string {
  const fields = expression.split(/\s+/).filter(Boolean).length;
  if (fields === 5) return `0 ${expression} *`;
  if (fields === 6) return `${expression} *`;
  return expression;
}

/** Whether the Relay accepts this `schedule.cron` expression. */
export function isValidCron(expression: string): boolean {
  return parsesAsSchedule(normalizeCron(expression));
}
