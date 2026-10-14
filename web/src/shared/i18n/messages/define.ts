/** One application-owned string in every supported locale. */
export type LocalizedMessage = { readonly en: string; readonly "zh-CN": string };

/** Identity helper that type-checks a feature's message table for both locales. */
export function defineMessages<const T extends Record<string, LocalizedMessage>>(messages: T): T {
  return messages;
}
