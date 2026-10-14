import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/shared/lib/cn";

// Canvas Markdown is untrusted channel content: links open in a separate
// browsing context without referrer, and images render as links so that
// opening a canvas never fetches third-party URLs on the reader's behalf.
const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} rel="noopener noreferrer nofollow" target="_blank">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} rel="noopener noreferrer nofollow" target="_blank">
        {alt || src}
      </a>
    ) : null,
};

export function CanvasMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:underline-offset-2 prose-pre:bg-muted prose-pre:text-foreground",
        className,
      )}
    >
      <ReactMarkdown components={COMPONENTS} remarkPlugins={[remarkGfm, remarkBreaks]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
