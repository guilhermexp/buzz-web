import { defineMessages } from "@/shared/i18n/messages/define";

/** Collaboration slice: forums copy. Keys use the `collab.forums.` prefix. */
export const forumsCollabMessages = defineMessages({
  "collab.forums.focusMissing": {
    en: "That forum post is no longer available.",
    "zh-CN": "该论坛帖子已不可用。",
  },
  "collab.forums.region": { en: "Forum posts", "zh-CN": "论坛帖子" },
  "collab.forums.topicsLabel": { en: "Forum topics", "zh-CN": "论坛主题" },
  "collab.forums.newPost": { en: "New post", "zh-CN": "发新帖" },
  "collab.forums.cancelPost": { en: "Cancel new post", "zh-CN": "取消发帖" },
  "collab.forums.title": { en: "Title", "zh-CN": "标题" },
  "collab.forums.titlePlaceholder": {
    en: "What is this post about?",
    "zh-CN": "这篇帖子关于什么？",
  },
  "collab.forums.bodyPlaceholder": { en: "Write your post...", "zh-CN": "撰写帖子内容..." },
  "collab.forums.titleRequired": {
    en: "Add a title before posting.",
    "zh-CN": "发布前请填写标题。",
  },
  "collab.forums.sortLabel": { en: "Sort posts", "zh-CN": "帖子排序" },
  "collab.forums.sortActivity": { en: "Latest activity", "zh-CN": "最新动态" },
  "collab.forums.sortNewest": { en: "Newest", "zh-CN": "最新发布" },
  "collab.forums.unread": { en: "Unread", "zh-CN": "未读" },
  "collab.forums.untitled": { en: "Untitled post", "zh-CN": "无标题帖子" },
  "collab.forums.replyCountOne": { en: "{count} reply", "zh-CN": "{count} 条回复" },
  "collab.forums.replyCountOther": { en: "{count} replies", "zh-CN": "{count} 条回复" },
  "collab.forums.lastActivity": { en: "Last activity {time}", "zh-CN": "最后动态：{time}" },
  "collab.forums.retry": { en: "Retry", "zh-CN": "重试" },
  "collab.forums.emptyTitle": { en: "No posts yet", "zh-CN": "还没有帖子" },
  "collab.forums.emptyHint": {
    en: "Start a discussion by creating the first post.",
    "zh-CN": "发布第一篇帖子，开启讨论。",
  },
  "collab.forums.emptyReadOnly": {
    en: "Posts in this forum will appear here.",
    "zh-CN": "此论坛的帖子会显示在这里。",
  },
  "collab.forums.loadOlder": { en: "Load older posts", "zh-CN": "加载更早的帖子" },
  "collab.forums.archived": { en: "This forum is archived.", "zh-CN": "此论坛已归档。" },
  "collab.forums.joinToPost": {
    en: "Join this forum to create posts.",
    "zh-CN": "加入此论坛后即可发帖。",
  },
  "collab.forums.offline": {
    en: "Reconnect to the Relay to post.",
    "zh-CN": "重新连接 Relay 后即可发帖。",
  },
  "collab.forums.relayRequired": {
    en: "Forum posts load from a connected Buzz Relay.",
    "zh-CN": "论坛帖子需要连接 Buzz Relay 才能加载。",
  },
  "collab.forums.backToPosts": { en: "Back to posts", "zh-CN": "返回帖子列表" },
  "collab.forums.noReplies": {
    en: "No replies yet. Be the first to respond.",
    "zh-CN": "还没有回复，来抢沙发吧。",
  },
  "collab.forums.replyPlaceholder": { en: "Reply to this post...", "zh-CN": "回复此帖子..." },
  "collab.forums.reply": { en: "Reply", "zh-CN": "回复" },
  "collab.forums.edited": { en: "(edited)", "zh-CN": "（已编辑）" },
  "collab.forums.editPost": { en: "Edit post", "zh-CN": "编辑帖子" },
  "collab.forums.editReply": { en: "Edit reply", "zh-CN": "编辑回复" },
  "collab.forums.deletePost": { en: "Delete post", "zh-CN": "删除帖子" },
  "collab.forums.deleteReply": { en: "Delete reply", "zh-CN": "删除回复" },
  "collab.forums.deletePostTitle": { en: "Delete post?", "zh-CN": "删除帖子？" },
  "collab.forums.deleteReplyTitle": { en: "Delete reply?", "zh-CN": "删除回复？" },
  "collab.forums.deletePostConfirm": {
    en: "This will permanently delete this post and cannot be undone.",
    "zh-CN": "这将永久删除此帖子，且无法撤销。",
  },
  "collab.forums.deleteReplyConfirm": {
    en: "This will permanently delete this reply and cannot be undone.",
    "zh-CN": "这将永久删除此回复，且无法撤销。",
  },
  "collab.forums.error.withDetail": {
    en: "{action} Relay response: {detail}",
    "zh-CN": "{action} Relay 返回：{detail}",
  },
  "collab.forums.error.load": { en: "Couldn't load forum posts.", "zh-CN": "无法加载论坛帖子。" },
  "collab.forums.error.post": { en: "Couldn't publish the post.", "zh-CN": "帖子发布失败。" },
  "collab.forums.error.reply": { en: "Couldn't publish the reply.", "zh-CN": "回复发布失败。" },
  "collab.forums.error.edit": { en: "Couldn't save the edit.", "zh-CN": "编辑保存失败。" },
  "collab.forums.error.delete": { en: "Couldn't delete it.", "zh-CN": "删除失败。" },
  "collab.forums.error.deletePermission": {
    en: "Only the author or a channel admin can delete this.",
    "zh-CN": "只有作者或频道管理员可以删除。",
  },
});
