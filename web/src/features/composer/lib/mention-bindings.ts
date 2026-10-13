import { mentionOccurrences } from "@/features/composer/lib/mention-occurrences";
import { t } from "@/shared/i18n";

/** A label bound to one exact key by the mention picker (insertion order is recipient order). */
export type MentionBindings = ReadonlyMap<string, string>;

export type MentionMemberCandidate = { displayName: string; pubkey: string };

type MentionMatch = { displayName: string; pubkey: string };

export class AmbiguousMentionError extends Error {
  readonly label: string;

  constructor(label: string) {
    super(t("composer.mentionAmbiguous", { label }));
    this.name = "AmbiguousMentionError";
    this.label = label;
  }
}

const normalizeLabel = (label: string) => label.trim().toLocaleLowerCase();

/**
 * Keep a second same-name selection from rebinding text already in the draft:
 * the second identity gets the desktop-compatible qualified label `Name (hexkey)`.
 */
export function selectedMentionLabel(
  displayName: string,
  pubkey: string,
  bindings: MentionBindings,
): string {
  const normalized = new Map(
    [...bindings].map(([label, key]) => [normalizeLabel(label), key.toLowerCase()]),
  );
  const conflicts = (label: string) => {
    const existing = normalized.get(normalizeLabel(label));
    return existing !== undefined && existing !== pubkey.toLowerCase();
  };
  if (!conflicts(displayName)) return displayName;
  const qualified = `${displayName} (${pubkey.toLowerCase()})`;
  let label = qualified;
  let suffix = 2;
  // A display name may itself look qualified. Never overwrite that binding.
  while (conflicts(label)) label = `${qualified} ${suffix++}`;
  return label;
}

function matchCandidates(
  bindings: MentionBindings,
  members: readonly MentionMemberCandidate[],
): MentionMatch[] {
  const selected = new Set([...bindings.keys()].map(normalizeLabel));
  const candidates: MentionMatch[] = [];
  for (const [displayName, pubkey] of bindings) {
    if (displayName.trim()) candidates.push({ displayName: displayName.trim(), pubkey });
  }
  for (const member of members) {
    const displayName = member.displayName.trim();
    if (displayName && !selected.has(normalizeLabel(displayName))) {
      candidates.push({ displayName, pubkey: member.pubkey });
    }
  }
  return candidates;
}

/**
 * Exact recipients for a Markdown body. Picker bindings win over typed member names;
 * a typed name shared by several identities throws instead of fanning out to all of them.
 */
export function extractMentionPubkeys(
  text: string,
  bindings: MentionBindings,
  members: readonly MentionMemberCandidate[],
): string[] {
  const winners = new Set<string>();
  for (const occurrence of mentionOccurrences(text, matchCandidates(bindings, members))) {
    const identities = new Set(occurrence.candidates.map((match) => match.pubkey.toLowerCase()));
    if (identities.size > 1) {
      throw new AmbiguousMentionError(occurrence.candidates[0].displayName);
    }
    for (const pubkey of identities) winners.add(pubkey);
  }
  const ordered: string[] = [];
  for (const pubkey of [...bindings.values(), ...members.map((member) => member.pubkey)]) {
    const normalized = pubkey.toLowerCase();
    if (winners.delete(normalized)) ordered.push(normalized);
  }
  return ordered;
}

/** Drop bindings whose label no longer appears in the body, so stale keys never receive a `p` tag. */
export function pruneMentionBindings(text: string, bindings: MentionBindings): Map<string, string> {
  const present = new Set(
    mentionOccurrences(
      text,
      [...bindings].map(([displayName, pubkey]) => ({ displayName, pubkey })),
    ).flatMap((occurrence) => occurrence.candidates.map((match) => match.displayName)),
  );
  return new Map([...bindings].filter(([label]) => present.has(label.trim())));
}
