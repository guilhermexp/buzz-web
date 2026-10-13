import { useEffect, useState } from "react";
import { authenticatedMediaObjectUrl } from "@/shared/api/media-client";

/**
 * A custom emoji glyph. Relay-hosted media needs NIP-98/Blossom auth, so it loads through
 * the shared authenticated object-URL cache; on failure the literal `:shortcode:` remains.
 */
export function CustomEmojiImage({
  shortcode,
  url,
  relayUrl,
  className = "inline-block h-[1.25em] w-auto max-w-none align-[-0.25em]",
}: {
  shortcode: string;
  url: string;
  relayUrl: string;
  className?: string;
}) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setFailed(false);
    authenticatedMediaObjectUrl(url, relayUrl)
      .then((value) => {
        if (!cancelled) setResolved(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl, url]);

  const label = `:${shortcode}:`;
  if (failed || !resolved) return <span title={label}>{label}</span>;
  return (
    <img
      alt={label}
      className={className}
      data-custom-emoji=""
      data-shortcode={shortcode}
      draggable={false}
      src={resolved}
      title={label}
    />
  );
}
