import { AtSign, LoaderCircle, MessageCircle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { fallbackProfile } from "@/features/chat/lib/chat-model";
import type { BuzzChannel, MemberRole, UserProfile } from "@/features/chat/lib/chat-types";
import { DialogFrame } from "@/features/chat/ui/AppDialogs";
import { Avatar } from "@/features/chat/ui/Avatar";
import { getLocale, t } from "@/shared/i18n";
import { parsePublicKey } from "@/shared/lib/pubkey";

const MANAGEABLE_ROLES = ["admin", "member", "guest"] as const;

function roleLabel(role: MemberRole): string {
  if (role === "owner") return t("member.roleOwner");
  if (role === "admin") return t("member.roleAdmin");
  if (role === "guest") return t("member.roleGuest");
  if (role === "bot") return t("member.roleBot");
  return t("member.roleMember");
}

export function MemberDialog({
  channel,
  profiles,
  presence,
  relayUrl,
  currentPubkey,
  canManage,
  onClose,
  onMention,
  onOpenDm,
  onSetMember,
  onRemoveMember,
  initialAddOpen = false,
}: {
  channel: BuzzChannel;
  profiles: Record<string, UserProfile>;
  presence: Record<string, "online" | "away" | "offline">;
  relayUrl: string;
  currentPubkey: string;
  canManage: boolean;
  onClose: () => void;
  onMention: (name: string) => void;
  onOpenDm: (pubkey: string) => Promise<void>;
  onSetMember: (pubkey: string, role: "admin" | "member" | "guest") => Promise<void>;
  onRemoveMember: (pubkey: string) => Promise<void>;
  /** Open with the add-member form expanded (channel intro "Add people"). */
  initialAddOpen?: boolean;
}) {
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  // The role a pending change requested: shown (disabled, with a spinner)
  // only while the Relay write is in flight, then the roster is the truth.
  const [requestedRoles, setRequestedRoles] = useState<Record<string, MemberRole>>({});
  const [identity, setIdentity] = useState("");
  const [newRole, setNewRole] = useState<(typeof MANAGEABLE_ROLES)[number]>("member");
  const [pending, setPending] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const members = useMemo(
    () =>
      channel.members
        .map((member) => ({
          member,
          profile: profiles[member.pubkey] ?? fallbackProfile(member.pubkey),
        }))
        .sort(
          (left, right) =>
            Number(right.profile.isAgent) - Number(left.profile.isAgent) ||
            left.profile.name.localeCompare(right.profile.name, getLocale()),
        ),
    [channel.members, profiles],
  );
  const removeProfile = removeTarget
    ? (profiles[removeTarget] ?? fallbackProfile(removeTarget))
    : null;

  const run = async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("error.memberUpdate"));
      throw actionError;
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <DialogFrame
        closeOnEscape={!removeTarget}
        title={t("member.count", { count: members.length })}
        width="max-w-2xl"
        onClose={onClose}
      >
        <div className="flex min-h-0 max-h-[72dvh] flex-col">
          {canManage && channel.type !== "dm" ? (
            <div className="border-b p-3">
              <button
                aria-expanded={addOpen}
                className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium hover:bg-foreground/5"
                type="button"
                onClick={() => setAddOpen((open) => !open)}
              >
                <Plus className="h-4 w-4" />
                {t("member.add")}
              </button>
              {addOpen ? (
                <form
                  className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    let target: string;
                    try {
                      target = parsePublicKey(identity);
                    } catch (parseError) {
                      setError(
                        parseError instanceof Error ? parseError.message : t("error.pubkeyInvalid"),
                      );
                      return;
                    }
                    void run(`add:${target}`, () => onSetMember(target, newRole))
                      .then(() => {
                        setIdentity("");
                        setAddOpen(false);
                      })
                      .catch(() => undefined);
                  }}
                >
                  <input
                    aria-label={t("member.publicKey")}
                    className="h-9 min-w-0 rounded-md border bg-background px-3 font-mono text-xs outline-none"
                    placeholder={t("invite.memberIdentityPlaceholder")}
                    value={identity}
                    onChange={(event) => setIdentity(event.target.value)}
                  />
                  <select
                    aria-label={t("member.role")}
                    className="h-9 rounded-md border bg-background px-2 text-xs"
                    value={newRole}
                    onChange={(event) =>
                      setNewRole(event.target.value as (typeof MANAGEABLE_ROLES)[number])
                    }
                  >
                    {MANAGEABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
                    disabled={!identity.trim() || pending !== null}
                    type="submit"
                  >
                    {pending?.startsWith("add:") ? t("member.adding") : t("member.add")}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p className="border-b bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p>
          ) : null}
          <div className="buzz-scrollbar min-h-0 overflow-y-auto p-2">
            {members.map(({ member, profile }) => {
              const canEditMember =
                canManage &&
                member.pubkey !== currentPubkey &&
                member.role !== "owner" &&
                member.role !== "bot";
              return (
                <div
                  key={member.pubkey}
                  className="group flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-foreground/5"
                >
                  <Avatar
                    profile={profile}
                    relayUrl={relayUrl}
                    size={32}
                    showStatus
                    status={presence[member.pubkey]}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{profile.name}</div>
                    {canEditMember ? (
                      <select
                        aria-label={t("member.changeRole", { name: profile.name })}
                        className="-ml-1 h-5 max-w-full bg-transparent text-[10px] text-muted-foreground outline-none"
                        disabled={pending !== null}
                        value={requestedRoles[member.pubkey] ?? member.role}
                        onChange={(event) => {
                          const role = event.target.value as (typeof MANAGEABLE_ROLES)[number];
                          setRequestedRoles((current) => ({ ...current, [member.pubkey]: role }));
                          void run(`role:${member.pubkey}`, () => onSetMember(member.pubkey, role))
                            .catch(() => undefined)
                            .finally(() =>
                              setRequestedRoles((current) => {
                                const next = { ...current };
                                delete next[member.pubkey];
                                return next;
                              }),
                            );
                        }}
                      >
                        {MANAGEABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-[10px] text-muted-foreground">
                        {profile.isAgent ? t("member.remoteAgent") : roleLabel(member.role)}
                      </div>
                    )}
                  </div>
                  {pending?.endsWith(member.pubkey) ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : member.pubkey !== currentPubkey ? (
                    <div className="flex items-center">
                      {channel.type !== "dm" ? (
                        <button
                          aria-label={`@${profile.name}`}
                          className="buzz-icon-button h-7 w-7 flex-none"
                          title={`@${profile.name}`}
                          type="button"
                          onClick={() => {
                            onMention(profile.name);
                            onClose();
                          }}
                        >
                          <AtSign className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        aria-label={t("member.directMessage", { name: profile.name })}
                        className="buzz-icon-button h-7 w-7 flex-none"
                        title={t("member.directMessage", { name: profile.name })}
                        type="button"
                        onClick={() => void onOpenDm(member.pubkey)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </button>
                      {canEditMember ? (
                        <button
                          aria-label={t("member.remove", { name: profile.name })}
                          className="buzz-icon-button h-7 w-7 flex-none text-destructive"
                          title={t("member.remove", { name: profile.name })}
                          type="button"
                          onClick={() => setRemoveTarget(member.pubkey)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </DialogFrame>
      {removeTarget && removeProfile ? (
        <DialogFrame title={t("member.removeTitle")} onClose={() => setRemoveTarget(null)}>
          <div className="space-y-4 p-4">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("member.removeConfirm", { name: removeProfile.name, channel: channel.name })}
            </p>
            <div className="flex justify-end gap-2 border-t pt-4">
              <button
                className="h-9 rounded-md px-3 text-sm hover:bg-foreground/5"
                type="button"
                onClick={() => setRemoveTarget(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="inline-flex h-9 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-40"
                disabled={pending !== null}
                type="button"
                onClick={() =>
                  void run(`remove:${removeTarget}`, () => onRemoveMember(removeTarget))
                    .then(() => setRemoveTarget(null))
                    .catch(() => undefined)
                }
              >
                {pending?.startsWith("remove:") ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("member.removeAction")}
              </button>
            </div>
          </div>
        </DialogFrame>
      ) : null}
    </>
  );
}
