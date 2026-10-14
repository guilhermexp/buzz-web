export type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName: string;
    hProperties?: Record<string, string>;
    hChildren: Array<{ type: "text"; value: string }>;
  };
};

export type RemarkMentionsOptions = {
  mentionNames?: readonly string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionPattern(names: readonly string[]): RegExp {
  const alternatives = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return alternatives ? new RegExp(`@(?:${alternatives})`, "giu") : /(?!)/gu;
}

function previousCharacter(value: string, index: number): string {
  const characters = Array.from(value.slice(0, index));
  return characters[characters.length - 1] ?? "";
}

function nextCharacter(value: string, index: number): string {
  return Array.from(value.slice(index))[0] ?? "";
}

function hasMentionBoundaries(value: string, start: number, end: number): boolean {
  const previous = previousCharacter(value, start);
  const next = nextCharacter(value, end);
  const invalidLeft = previous ? /[\p{L}\p{N}_@]/u.test(previous) : false;
  const invalidRight = next ? /[\p{L}\p{N}_@]/u.test(next) : false;
  return !invalidLeft && !invalidRight;
}

function mentionNode(value: string): MarkdownNode {
  return {
    type: "mention",
    value,
    data: {
      hName: "mention",
      hChildren: [{ type: "text", value }],
    },
  };
}

function splitText(value: string, pattern: RegExp): MarkdownNode[] {
  pattern.lastIndex = 0;
  const parts: MarkdownNode[] = [];
  let lastIndex = 0;
  let match = pattern.exec(value);

  while (match) {
    const end = match.index + match[0].length;
    if (hasMentionBoundaries(value, match.index, end)) {
      if (match.index > lastIndex) {
        parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
      }
      parts.push(mentionNode(match[0]));
      lastIndex = end;
    }
    match = pattern.exec(value);
  }

  if (!parts.length) return [{ type: "text", value }];
  if (lastIndex < value.length) parts.push({ type: "text", value: value.slice(lastIndex) });
  return parts;
}

function shouldSkip(node: MarkdownNode): boolean {
  return [
    "code",
    "html",
    "image",
    "imageReference",
    "inlineCode",
    "link",
    "linkReference",
  ].includes(node.type);
}

function transformChildren(node: MarkdownNode, pattern: RegExp): void {
  if (!node.children || shouldSkip(node)) return;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child.type === "text" && child.value !== undefined) {
      node.children.splice(index, 1, ...splitText(child.value, pattern));
    } else {
      transformChildren(child, pattern);
    }
  }
}

export default function remarkMentions(options: RemarkMentionsOptions = {}) {
  const pattern = buildMentionPattern(options.mentionNames ?? []);
  return (tree: MarkdownNode) => transformChildren(tree, pattern);
}
