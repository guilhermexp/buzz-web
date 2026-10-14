export type MentionQuery = {
  query: string;
  startIndex: number;
  endIndex: number;
};

const isMentionBoundary = (character: string) => /[\s([{]/.test(character);

export function detectMentionQuery(
  value: string,
  cursorPosition: number,
  knownNames: string[],
): MentionQuery | null {
  const endIndex = Math.max(0, Math.min(cursorPosition, value.length));
  const beforeCursor = value.slice(0, endIndex);
  const scanStart = Math.max(0, beforeCursor.length - 80);
  const knownNamesLower = knownNames.map((name) => name.toLocaleLowerCase());

  for (let index = beforeCursor.length - 1; index >= scanStart; index -= 1) {
    const character = beforeCursor[index];
    if (character === "\n") break;
    if (character !== "@") continue;
    if (index > 0 && !isMentionBoundary(beforeCursor[index - 1])) continue;

    const query = beforeCursor.slice(index + 1);
    if (!query.includes(" ")) return { query, startIndex: index, endIndex };

    const lowerQuery = query.toLocaleLowerCase();
    if (lowerQuery.endsWith(" ") && knownNamesLower.includes(lowerQuery.trimEnd())) return null;
    if (knownNamesLower.some((name) => name.startsWith(lowerQuery))) {
      return { query, startIndex: index, endIndex };
    }
    return null;
  }

  return null;
}
