import { LoaderCircle, MessageSquare } from "lucide-react";
import { type ReactNode, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { t } from "@/shared/i18n";
import { relativeTime } from "@/shared/lib/relative-time";
import { buildCommentTemplate } from "../../lib/forge-events";
import type { Repository } from "../../lib/nip34";
import { useForgePublish } from "../../use-forge";
import { forgeErrorMessage, PersonChip, primaryButton, textareaClass } from "./forge-ui";

export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}

export function CommentCard({
  author,
  createdAt,
  content,
  aside,
}: {
  author: string;
  createdAt: number;
  content: string;
  aside?: ReactNode;
}) {
  return (
    <article className="rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b bg-foreground/[0.025] px-3 py-2">
        <PersonChip pubkey={author} />
        <span className="text-xs text-muted-foreground">{relativeTime(createdAt)}</span>
        <span className="flex-1" />
        {aside}
      </header>
      <div className="px-3 py-2.5">
        {content.trim() ? (
          <MarkdownBody content={content} />
        ) : (
          <p className="text-xs italic text-muted-foreground">{t("projects.noDescription")}</p>
        )}
      </div>
    </article>
  );
}

/** Kind 1 reply bound to an issue or PR root (desktop comment shape). */
export function CommentComposer({
  rootId,
  rootAuthor,
  repository,
  label,
}: {
  rootId: string;
  rootAuthor: string;
  repository: Repository;
  label: string;
}) {
  const [content, setContent] = useState("");
  const publish = useForgePublish();
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          try {
            await publish.mutateAsync([
              buildCommentTemplate({ rootId, rootAuthor, repository, content }),
            ]);
            setContent("");
            toast.success(t("projects.comments.posted"));
          } catch (error) {
            toast.error(forgeErrorMessage(error));
          }
        })();
      }}
    >
      <label className="sr-only" htmlFor={`comment-${rootId}`}>
        {label}
      </label>
      <textarea
        className={textareaClass}
        id={`comment-${rootId}`}
        placeholder={label}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="flex justify-end">
        <button
          className={primaryButton}
          disabled={!content.trim() || publish.isPending}
          type="submit"
        >
          {publish.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          {t("projects.comments.submit")}
        </button>
      </div>
    </form>
  );
}
