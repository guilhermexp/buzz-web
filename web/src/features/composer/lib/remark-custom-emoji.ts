import type { MarkdownNode } from "@/features/chat/lib/remark-mentions";

export type RemarkCustomEmojiOptions = {
  /** Shortcodes declared by the message's own `emoji` tags (desktop useMessageEmoji). */
  shortcodes?: readonly string[];
};

const SKIPPED = new Set(["code", "html", "inlineCode", "link", "linkReference", "image"]);

function emojiNode(shortcode: string): MarkdownNode {
  return {
    type: "customEmoji",
    value: `:${shortcode}:`,
    data: {
      hName: "custom-emoji",
      hProperties: { shortcode },
      hChildren: [{ type: "text", value: `:${shortcode}:` }],
    },
  };
}

function split(value: string, pattern: RegExp): MarkdownNode[] {
  const parts: MarkdownNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    // Same boundary rule as desktop: `word:emoji:` and URLs stay literal.
    if (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) continue;
    if (start > lastIndex) parts.push({ type: "text", value: value.slice(lastIndex, start) });
    parts.push(emojiNode(match[0].slice(1, -1).toLowerCase()));
    lastIndex = start + match[0].length;
  }
  if (!parts.length) return [{ type: "text", value }];
  if (lastIndex < value.length) parts.push({ type: "text", value: value.slice(lastIndex) });
  return parts;
}

function transform(node: MarkdownNode, pattern: RegExp): void {
  if (!node.children || SKIPPED.has(node.type)) return;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child.type === "text" && child.value !== undefined) {
      node.children.splice(index, 1, ...split(child.value, pattern));
    } else {
      transform(child, pattern);
    }
  }
}

/** Turn `:shortcode:` into `custom-emoji` elements, only for shortcodes the event declares. */
export default function remarkCustomEmoji(options: RemarkCustomEmojiOptions = {}) {
  const alternation = [...new Set(options.shortcodes ?? [])]
    .filter((shortcode) => /^[a-z0-9_-]+$/.test(shortcode))
    .sort((left, right) => right.length - left.length)
    .join("|");
  return (tree: MarkdownNode) => {
    if (alternation) transform(tree, new RegExp(`:(?:${alternation}):`, "gi"));
  };
}
