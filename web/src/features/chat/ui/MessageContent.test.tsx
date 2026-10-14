import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageContent } from "@/features/chat/ui/MessageContent";

const PERSON = "11".repeat(32);
const AGENT = "22".repeat(32);
const MULTILINE_CONTENT = "@Alex 第一行\n@Codex(remote) 第二行";
const PLAIN_CONTENT = "@Unknown and `@Alex`";
const IMAGE_URL = "https://relay.example.com/media/poster.png";

const FORMATTED_CONTENT =
  "**bold** *it* ~~old~~ `x`\n\n- one\n- two\n\n1. first\n\n> quote\n\n```ts\nrun()\n```";

describe("MessageContent", () => {
  it("renders human and agent mentions and preserves soft line breaks", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={MULTILINE_CONTENT}
        mentions={[
          { pubkey: PERSON, name: "Alex", isAgent: false },
          { pubkey: AGENT, name: "Codex(remote)", isAgent: true },
        ]}
        relayUrl="wss://relay.example.com"
      />,
    );

    expect(html.match(/data-mention=""/g)).toHaveLength(2);
    expect(html).toContain(`data-mention-pubkey="${PERSON}"`);
    expect(html).toContain(`data-mention-pubkey="${AGENT}"`);
    expect(html).toContain('buzz-message-mention-prefix">@</span>Alex');
    expect(html).toContain('data-mention-agent="true"');
    expect(html).toContain("buzz-message-mention-icon");
    expect(html).toContain("<br/>");
  });

  it("keeps untagged mentions and inline code as plain content", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={PLAIN_CONTENT}
        mentions={[{ pubkey: PERSON, name: "Alex", isAgent: false }]}
        relayUrl="wss://relay.example.com"
      />,
    );

    expect(html).not.toContain('data-mention=""');
    expect(html).toContain("@Unknown and <code>@Alex</code>");
  });

  it("reserves the final imeta dimensions while a protected image loads", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={`![poster](${IMAGE_URL})`}
        mediaTags={[
          [
            "imeta",
            `url ${IMAGE_URL}`,
            "m image/png",
            `x ${"ab".repeat(32)}`,
            "size 1000",
            "dim 1080x1920",
          ],
        ]}
        relayUrl="wss://relay.example.com"
      />,
    );

    expect(html).toContain('data-protected-image-frame="true"');
    expect(html).toContain("aspect-ratio:1080 / 1920");
    expect(html).toContain("width:min(100%, 144px)");
  });
});

describe("MessageContent composer interop", () => {
  const relayUrl = "wss://relay.example.com";

  it("renders desktop formatting from composer Markdown", () => {
    const html = renderToStaticMarkup(
      <MessageContent content={FORMATTED_CONTENT} relayUrl={relayUrl} />,
    );
    for (const fragment of [
      "<strong>bold</strong>",
      "<em>it</em>",
      "<del>old</del>",
      "<code>x</code>",
      "<ul>",
      "<ol>",
      "<blockquote>",
      '<code class="language-ts">run()',
    ]) {
      expect(html).toContain(fragment);
    }
  });

  it("binds a same-name label only through its full-key qualification", () => {
    const other = "33".repeat(32);
    const html = renderToStaticMarkup(
      <MessageContent
        content={`@Alex and @Alex (${other})`}
        mentions={[
          { pubkey: PERSON, name: "Alex", isAgent: false },
          { pubkey: other, name: "Alex", isAgent: false },
        ]}
        relayUrl={relayUrl}
      />,
    );
    expect(html.match(/data-mention=""/g)).toHaveLength(1);
    expect(html).toContain(`data-mention-pubkey="${other}"`);
    expect(html).toContain("Alex (33333333…3333)");
  });

  it("renders tagged custom emoji and leaves undeclared shortcodes literal", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content=":party: and :nope: and `:party:`"
        mediaTags={[["emoji", "party", "https://cdn.example.com/party.png"]]}
        relayUrl={relayUrl}
      />,
    );
    // The glyph loads asynchronously; until then the declared shortcode is a labelled span.
    expect(html).toContain('<span title=":party:">:party:</span>');
    expect(html).toContain("and :nope: and <code>:party:</code>");
  });

  it("plays voice-note attachments instead of linking a download", () => {
    const url = "https://relay.example.com/media/voice.wav";
    const html = renderToStaticMarkup(
      <MessageContent
        content={`listen\n\n[voice-note-1.wav](${url})`}
        mediaTags={[
          [
            "imeta",
            `url ${url}`,
            "m audio/wav",
            `x ${"ab".repeat(32)}`,
            "duration 3.5",
            "filename voice-note-1.wav",
          ],
        ]}
        relayUrl={relayUrl}
      />,
    );
    expect(html).toContain('aria-label="Play voice note"');
    expect(html).not.toContain(`href="${url}"`);
    expect(html).not.toMatch(/<p>\s*<div/);
  });
});
