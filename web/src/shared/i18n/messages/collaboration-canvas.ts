import { defineMessages } from "@/shared/i18n/messages/define";

/** Collaboration slice: canvas copy. Keys use the `collab.canvas.` prefix. */
export const canvasCollabMessages = defineMessages({
  "collab.canvas.title": { en: "Canvas", "zh-CN": "画布" },
  "collab.canvas.close": { en: "Close canvas", "zh-CN": "关闭画布" },
  "collab.canvas.resize": { en: "Resize canvas panel", "zh-CN": "调整画布面板宽度" },
  "collab.canvas.history": { en: "History", "zh-CN": "历史记录" },
  "collab.canvas.hideHistory": { en: "Hide history", "zh-CN": "隐藏历史记录" },
  "collab.canvas.loading": { en: "Loading canvas…", "zh-CN": "正在加载画布…" },
  "collab.canvas.empty.title": { en: "No canvas yet", "zh-CN": "还没有画布" },
  "collab.canvas.empty.body": {
    en: "A canvas is this channel's shared Markdown document. Keep plans, decisions and links where every member can find them.",
    "zh-CN": "画布是此频道共享的 Markdown 文档。把计划、决定和链接放在这里，方便每位成员查找。",
  },
  "collab.canvas.empty.readOnly": {
    en: "No canvas set for this channel.",
    "zh-CN": "此频道尚未设置画布。",
  },
  "collab.canvas.create": { en: "Create canvas", "zh-CN": "创建画布" },
  "collab.canvas.edit": { en: "Edit canvas", "zh-CN": "编辑画布" },
  "collab.canvas.save": { en: "Save canvas", "zh-CN": "保存画布" },
  "collab.canvas.saving": { en: "Saving…", "zh-CN": "正在保存…" },
  "collab.canvas.cancel": { en: "Cancel", "zh-CN": "取消" },
  "collab.canvas.content": { en: "Canvas content", "zh-CN": "画布内容" },
  "collab.canvas.placeholder": {
    en: "Write your canvas content in Markdown...",
    "zh-CN": "使用 Markdown 编写画布内容……",
  },
  "collab.canvas.saveShortcut": {
    en: "Ctrl+S or ⌘S saves",
    "zh-CN": "按 Ctrl+S 或 ⌘S 保存",
  },
  "collab.canvas.lastEdited": {
    en: "Last edited by {name} · {time}",
    "zh-CN": "{name} 最后编辑于 {time}",
  },
  "collab.canvas.noAccess.title": {
    en: "No access to this canvas",
    "zh-CN": "无法访问此画布",
  },
  "collab.canvas.noAccess.body": {
    en: "Only members of this private channel can read or edit its canvas.",
    "zh-CN": "只有此私有频道的成员才能查看或编辑其画布。",
  },
  "collab.canvas.unavailable": {
    en: "This channel is no longer available, so its canvas can't be shown.",
    "zh-CN": "此频道已不可用，无法显示其画布。",
  },
  "collab.canvas.loadFailed": {
    en: "Couldn't load the canvas: {detail}",
    "zh-CN": "无法加载画布：{detail}",
  },
  "collab.canvas.retry": { en: "Retry", "zh-CN": "重试" },
  "collab.canvas.liveStopped": {
    en: "Live updates stopped. Showing the last loaded version.",
    "zh-CN": "实时更新已停止，正在显示最后加载的版本。",
  },
  "collab.canvas.archived": {
    en: "This channel is archived, so its canvas is read-only.",
    "zh-CN": "此频道已归档，画布为只读。",
  },
  "collab.canvas.managersOnly": {
    en: "Only channel owners and admins can edit this canvas.",
    "zh-CN": "只有频道所有者和管理员可以编辑此画布。",
  },
  "collab.canvas.unverified": {
    en: "Saved. We couldn't verify against the latest revision just now — check History if a concurrent edit appears.",
    "zh-CN": "已保存。暂时无法与最新修订核对——如果出现并发编辑，请查看历史记录。",
  },
  "collab.canvas.superseded": {
    en: "A concurrent edit is now current. Your save was preserved in History — restore it there if needed.",
    "zh-CN": "另一个并发编辑已成为当前版本。你的保存已保留在历史记录中，如有需要可在那里恢复。",
  },
  "collab.canvas.saveFailed": {
    en: "Couldn't save the canvas: {detail}",
    "zh-CN": "无法保存画布：{detail}",
  },
  "collab.canvas.forbidden": {
    en: "You're not a member of this channel, so the canvas wasn't saved.",
    "zh-CN": "你不是此频道的成员，画布未保存。",
  },
  "collab.canvas.archivedRejected": {
    en: "This channel is archived, so the canvas wasn't saved.",
    "zh-CN": "此频道已归档，画布未保存。",
  },
  "collab.canvas.timeline": {
    en: "The current canvas revision is timestamped too far in the future. Check this device's clock, then try again.",
    "zh-CN": "当前画布修订的时间戳过于超前。请检查此设备的时钟后重试。",
  },
  "collab.canvas.conflict.title": {
    en: "This canvas changed since you loaded it",
    "zh-CN": "自你加载以来，画布已被更改",
  },
  "collab.canvas.conflict.reviewTitle": {
    en: "The canvas was updated while you were editing",
    "zh-CN": "你编辑期间画布已被更新",
  },
  "collab.canvas.conflict.body": {
    en: "Your draft is kept. Compare it with the latest version, then merge, overwrite the latest version with your draft, or discard your draft.",
    "zh-CN": "你的草稿已保留。请与最新版本比较，然后选择合并、用你的草稿覆盖最新版本，或放弃草稿。",
  },
  "collab.canvas.conflict.latest": {
    en: "Latest version by {name} · {time}",
    "zh-CN": "{name} 的最新版本 · {time}",
  },
  "collab.canvas.conflict.latestRegion": {
    en: "Latest canvas version",
    "zh-CN": "最新画布版本",
  },
  "collab.canvas.conflict.noHead": {
    en: "The canvas currently has no revision.",
    "zh-CN": "画布当前没有任何修订。",
  },
  "collab.canvas.conflict.merge": { en: "Merge changes", "zh-CN": "合并更改" },
  "collab.canvas.conflict.overwrite": { en: "Overwrite with my draft", "zh-CN": "用我的草稿覆盖" },
  "collab.canvas.conflict.discard": { en: "Discard my draft", "zh-CN": "放弃我的草稿" },
  "collab.canvas.updated": {
    en: "{name} updated the canvas while you were editing. Your draft is kept.",
    "zh-CN": "{name} 在你编辑时更新了画布。你的草稿已保留。",
  },
  "collab.canvas.review": { en: "Review changes", "zh-CN": "查看更改" },
  "collab.canvas.merged.clean": {
    en: "Merged with the latest version. Review the result, then save.",
    "zh-CN": "已与最新版本合并。请检查结果后保存。",
  },
  "collab.canvas.merged.conflicts": {
    en: "Merged with the latest version. {count} conflicting section(s) are marked between <<<<<<< and >>>>>>> lines — resolve them, then save.",
    "zh-CN": "已与最新版本合并。有 {count} 处冲突用 <<<<<<< 和 >>>>>>> 行标出——解决后再保存。",
  },
  "collab.canvas.merge.ours": { en: "Your draft", "zh-CN": "你的草稿" },
  "collab.canvas.merge.theirs": { en: "Latest canvas", "zh-CN": "最新画布" },
  "collab.canvas.history.title": { en: "Canvas history", "zh-CN": "画布历史记录" },
  "collab.canvas.history.loading": { en: "Loading history…", "zh-CN": "正在加载历史记录…" },
  "collab.canvas.history.empty": { en: "No revisions yet.", "zh-CN": "还没有修订。" },
  "collab.canvas.history.failed": {
    en: "Couldn't load history: {detail}",
    "zh-CN": "无法加载历史记录：{detail}",
  },
  "collab.canvas.history.current": { en: "Current", "zh-CN": "当前" },
  "collab.canvas.history.loadOlder": { en: "Load older", "zh-CN": "加载更早的修订" },
  "collab.canvas.history.loadingOlder": { en: "Loading…", "zh-CN": "正在加载…" },
  "collab.canvas.history.view": { en: "Revision view", "zh-CN": "修订视图" },
  "collab.canvas.history.preview": { en: "Preview", "zh-CN": "预览" },
  "collab.canvas.history.changes": { en: "Changes vs current", "zh-CN": "与当前版本的差异" },
  "collab.canvas.history.identical": {
    en: "Identical to the current canvas.",
    "zh-CN": "与当前画布相同。",
  },
  "collab.canvas.history.emptyRevision": {
    en: "This revision is empty.",
    "zh-CN": "此修订为空。",
  },
  "collab.canvas.history.restore": { en: "Restore this revision", "zh-CN": "恢复此修订" },
  "collab.canvas.history.restoring": { en: "Restoring…", "zh-CN": "正在恢复…" },
  "collab.canvas.history.confirmTitle": {
    en: "Restore this revision?",
    "zh-CN": "要恢复此修订吗？",
  },
  "collab.canvas.history.confirmBody": {
    en: "This publishes {name}'s revision from {time} as the current canvas for everyone in this channel. History is preserved.",
    "zh-CN": "这会将 {name} 于 {time} 的修订发布为此频道所有人的当前画布。历史记录会被保留。",
  },
  "collab.canvas.history.confirm": { en: "Restore", "zh-CN": "恢复" },
  "collab.canvas.history.restored": {
    en: "Revision restored. It's now the current canvas.",
    "zh-CN": "修订已恢复，现在是当前画布。",
  },
  "collab.canvas.history.restoreUnverified": {
    en: "Restored. We couldn't verify against the latest revision just now — check the canvas if a concurrent edit appears.",
    "zh-CN": "已恢复。暂时无法与最新修订核对——如果出现并发编辑，请检查画布。",
  },
  "collab.canvas.history.restoreConflict": {
    en: "The canvas changed since you chose this revision. Review the latest version, then try again.",
    "zh-CN": "自你选择此修订以来画布已被更改。请查看最新版本后重试。",
  },
  "collab.canvas.history.restoreSuperseded": {
    en: "A concurrent edit is now current. Your restore was preserved in History.",
    "zh-CN": "另一个并发编辑已成为当前版本。你的恢复已保留在历史记录中。",
  },
  "collab.canvas.history.restoreFailed": {
    en: "Couldn't restore the revision: {detail}",
    "zh-CN": "无法恢复此修订：{detail}",
  },
});
