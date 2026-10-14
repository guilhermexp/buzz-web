import { getLocale, type MessageKey, t } from "@/shared/i18n";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** Locale-aware "5 minutes ago"; anything under a minute reads as "now". */
export function formatRelativeTime(unixSeconds: number, nowSeconds: number): string {
  const delta = Math.max(0, nowSeconds - unixSeconds);
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  for (const [unit, seconds] of UNITS) {
    if (delta >= seconds) return format.format(-Math.floor(delta / seconds), unit);
  }
  return format.format(0, "second");
}

export function formatAbsoluteTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    unixSeconds * 1_000,
  );
}

export function formatReplyCount(count: number): string {
  return new Intl.PluralRules(getLocale()).select(count) === "one"
    ? t("collab.forums.replyCountOne", { count })
    : t("collab.forums.replyCountOther", { count });
}

const MAX_DETAIL_LENGTH = 200;

/** Localized failure with the Relay's bounded detail (e.g. "invalid: must be event author"). */
export function forumActionError(action: MessageKey, error: unknown): Error {
  const raw = error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : "";
  const detail = raw.length > MAX_DETAIL_LENGTH ? `${raw.slice(0, MAX_DETAIL_LENGTH - 1)}…` : raw;
  return new Error(
    detail ? t("collab.forums.error.withDetail", { action: t(action), detail }) : t(action),
  );
}
