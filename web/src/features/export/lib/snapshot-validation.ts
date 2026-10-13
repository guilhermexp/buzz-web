/**
 * Port of desktop `managed_agents/definition_validation.rs` and the portable ACP command rule
 * from `backend.rs`. Snapshot text is shown to a person and then executed, so invisible or
 * formatting characters are rejected rather than stripped.
 */

export const MAX_DISPLAY_NAME_CHARS = 128;
export const MAX_SYSTEM_PROMPT_BYTES = 64 * 1024;
export const MAX_AGENT_DESCRIPTION_CHARS = 280;

const EMOJI_VARIATION_SELECTOR = 0xfe0f;
const ZERO_WIDTH_JOINER = 0x200d;
const EXTENDED_PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const CONTROL = /^\p{Cc}$/u;

export type TextViolation =
  | { reason: "required" }
  | { reason: "tooLong"; max: number }
  | { reason: "invisible"; codePoint: string };

const DEFAULT_IGNORABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

function isDefaultIgnorable(codePoint: number): boolean {
  return DEFAULT_IGNORABLE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

function isPictographic(character: string | undefined): boolean {
  return character !== undefined && EXTENDED_PICTOGRAPHIC.test(character);
}

function isAllowedEmojiFormat(characters: readonly string[], index: number): boolean {
  const codePoint = characters[index].codePointAt(0);
  if (codePoint === EMOJI_VARIATION_SELECTOR) {
    const previous = characters[index - 1];
    return previous !== undefined && (/^[#*0-9]$/.test(previous) || isPictographic(previous));
  }
  if (codePoint === ZERO_WIDTH_JOINER) {
    let previous = index - 1;
    let hasBase = false;
    while (previous >= 0) {
      const value = characters[previous].codePointAt(0) ?? 0;
      if (value !== EMOJI_VARIATION_SELECTOR && !(value >= 0x1f3fb && value <= 0x1f3ff)) {
        hasBase = isPictographic(characters[previous]);
        break;
      }
      previous -= 1;
    }
    return hasBase && isPictographic(characters[index + 1]);
  }
  return false;
}

export function visibleTextViolation(
  value: string,
  allowLayoutControls: boolean,
): TextViolation | null {
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const codePoint = character.codePointAt(0) ?? 0;
    const layoutControl = allowLayoutControls && (character === "\n" || character === "\t");
    if (
      (!layoutControl && CONTROL.test(character)) ||
      (isDefaultIgnorable(codePoint) && !isAllowedEmojiFormat(characters, index))
    ) {
      return {
        reason: "invisible",
        codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
      };
    }
  }
  return null;
}

export type DefinitionTextField = "displayName" | "systemPrompt" | "description";

/** First violation across display name, instructions, and description, mirroring desktop order. */
export function definitionTextViolation(input: {
  displayName: string;
  systemPrompt: string;
  description: string | null;
}): { field: DefinitionTextField; violation: TextViolation } | null {
  if (!input.displayName.trim()) return { field: "displayName", violation: { reason: "required" } };
  if (Array.from(input.displayName).length > MAX_DISPLAY_NAME_CHARS) {
    return { field: "displayName", violation: { reason: "tooLong", max: MAX_DISPLAY_NAME_CHARS } };
  }
  if (new TextEncoder().encode(input.systemPrompt).length > MAX_SYSTEM_PROMPT_BYTES) {
    return {
      field: "systemPrompt",
      violation: { reason: "tooLong", max: MAX_SYSTEM_PROMPT_BYTES },
    };
  }
  const nameViolation = visibleTextViolation(input.displayName, false);
  if (nameViolation) return { field: "displayName", violation: nameViolation };
  const promptViolation = visibleTextViolation(input.systemPrompt, true);
  if (promptViolation) return { field: "systemPrompt", violation: promptViolation };
  if (input.description !== null) {
    if (Array.from(input.description).length > MAX_AGENT_DESCRIPTION_CHARS) {
      return {
        field: "description",
        violation: { reason: "tooLong", max: MAX_AGENT_DESCRIPTION_CHARS },
      };
    }
    const descriptionViolation = visibleTextViolation(input.description, false);
    if (descriptionViolation) return { field: "description", violation: descriptionViolation };
  }
  return null;
}
