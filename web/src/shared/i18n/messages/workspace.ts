import { defineMessages } from "@/shared/i18n/messages/define";

export const workspaceMessages = defineMessages({
  "workspace.tool.workflows": { en: "Workflows", "zh-CN": "工作流" },
  "workspace.tool.pulse": { en: "Pulse", "zh-CN": "Pulse" },
  "workspace.tool.remote": { en: "Remote workspace", "zh-CN": "远程工作区" },
  "workspace.moreTools": { en: "More tools", "zh-CN": "更多工具" },
  "workspace.mobileNavigation": { en: "Main navigation", "zh-CN": "主导航" },
  "workspace.copyFailed": {
    en: "Couldn't copy to the clipboard. Check the browser's clipboard permission.",
    "zh-CN": "无法复制到剪贴板。请检查浏览器的剪贴板权限。",
  },
  "workspace.settings.export": { en: "Export", "zh-CN": "导出" },
  "workspace.settings.notifications": { en: "Notifications", "zh-CN": "通知" },

  "workspace.sidebar.favorites": { en: "Favorites", "zh-CN": "收藏" },
  "workspace.sidebar.channelActions": { en: "Actions for {name}", "zh-CN": "{name} 的操作" },
  "workspace.sidebar.markRead": { en: "Mark as read", "zh-CN": "标为已读" },
  "workspace.sidebar.markUnread": { en: "Mark unread", "zh-CN": "标为未读" },
  "workspace.sidebar.moveUp": { en: "Move up", "zh-CN": "上移" },
  "workspace.sidebar.moveDown": { en: "Move down", "zh-CN": "下移" },
  "workspace.sidebar.moved": {
    en: "Moved {name} to position {position} of {total}",
    "zh-CN": "已将 {name} 移到第 {position} 位（共 {total} 个）",
  },
  "workspace.sidebar.copyLink": { en: "Copy link", "zh-CN": "复制链接" },
  "workspace.sidebar.copyId": { en: "Copy channel ID", "zh-CN": "复制频道 ID" },
  "workspace.sidebar.linkCopied": { en: "Channel link copied", "zh-CN": "已复制频道链接" },
  "workspace.sidebar.idCopied": { en: "Channel ID copied", "zh-CN": "已复制频道 ID" },
  "workspace.sidebar.leave": { en: "Leave channel", "zh-CN": "退出频道" },
  "workspace.sidebar.leaveAction": { en: "Leave", "zh-CN": "退出" },
  "workspace.sidebar.leaveConfirm": {
    en: 'Leave "{name}"? You\'ll stop receiving its messages and can rejoin later.',
    "zh-CN": "退出“{name}”？你将不再收到它的消息，之后可以重新加入。",
  },
  "workspace.sidebar.leaveFailed": {
    en: "The Relay did not accept leaving this channel.",
    "zh-CN": "Relay 未接受退出此频道。",
  },

  "workspace.thread.backTo": { en: "Back to {channel}", "zh-CN": "返回 {channel}" },
  "workspace.thread.expand": { en: "Expand thread", "zh-CN": "展开线程" },
  "workspace.thread.showBeside": {
    en: "Show thread beside channel",
    "zh-CN": "在频道旁显示线程",
  },

  "workspace.intro.start": {
    en: "This is the beginning of the channel.",
    "zh-CN": "这里是频道的开始。",
  },
  "workspace.intro.startPrivate": {
    en: "This is the beginning of the private channel.",
    "zh-CN": "这里是私有频道的开始。",
  },
  "workspace.intro.addPeople": { en: "Add people", "zh-CN": "添加成员" },
  "workspace.intro.addPeopleHint": { en: "Invite members.", "zh-CN": "邀请成员加入。" },
  "workspace.intro.addAgent": { en: "Add agent", "zh-CN": "添加 Agent" },
  "workspace.intro.addAgentHint": { en: "Add an agent here.", "zh-CN": "将 Agent 加入此频道。" },

  "workspace.addAgent.title": {
    en: "Add agents to #{channel}",
    "zh-CN": "添加 Agent 到 #{channel}",
  },
  "workspace.addAgent.description": {
    en: "Agents that announced themselves on this Relay (kind 10100).",
    "zh-CN": "已在此 Relay 上公布自身信息的 Agent（kind 10100）。",
  },
  "workspace.addAgent.refresh": { en: "Refresh agents", "zh-CN": "刷新 Agent" },
  "workspace.addAgent.loading": { en: "Loading agents…", "zh-CN": "正在加载 Agent…" },
  "workspace.addAgent.loadError": {
    en: "Couldn't load agents from the Relay.",
    "zh-CN": "无法从 Relay 加载 Agent。",
  },
  "workspace.addAgent.empty": {
    en: "No agents have announced themselves on this Relay.",
    "zh-CN": "此 Relay 上还没有 Agent 公布自身信息。",
  },
  "workspace.addAgent.add": { en: "Add", "zh-CN": "添加" },
  "workspace.addAgent.addNamed": { en: "Add {name}", "zh-CN": "添加 {name}" },
  "workspace.addAgent.adding": { en: "Adding…", "zh-CN": "正在添加…" },
  "workspace.addAgent.inChannel": { en: "In channel", "zh-CN": "已在频道中" },
  "workspace.addAgent.failed": {
    en: "The Relay did not accept adding this agent.",
    "zh-CN": "Relay 未接受添加此 Agent。",
  },

  "workspace.search.channels": { en: "Channels", "zh-CN": "频道" },
  "workspace.search.recent": { en: "Recent", "zh-CN": "最近" },
  "workspace.search.messages": { en: "Messages", "zh-CN": "消息" },
  "workspace.search.directMessage": { en: "Direct message", "zh-CN": "私聊" },
  "workspace.search.inThread": { en: "in thread", "zh-CN": "线程内" },
  "workspace.search.clearScope": { en: "Search everywhere", "zh-CN": "搜索全部" },
  "workspace.search.keepTyping": {
    en: "Type at least two characters to search messages.",
    "zh-CN": "至少输入两个字符以搜索消息。",
  },

  "workspace.appearance.readability": { en: "Readability", "zh-CN": "可读性" },
  "workspace.appearance.scope": {
    en: "Saved in this browser. Independent of browser zoom.",
    "zh-CN": "保存在此浏览器中，不受浏览器缩放影响。",
  },
  "workspace.appearance.fontSize": { en: "Font size", "zh-CN": "字号" },
  "workspace.appearance.fontSizeHint": {
    en: "Applies across conversations and message text",
    "zh-CN": "应用于会话和消息文本",
  },
  "workspace.appearance.fontSize.smaller": { en: "Smaller", "zh-CN": "较小" },
  "workspace.appearance.fontSize.default": { en: "Default", "zh-CN": "默认" },
  "workspace.appearance.fontSize.larger": { en: "Larger", "zh-CN": "较大" },
  "workspace.appearance.density": { en: "Conversation density", "zh-CN": "会话密度" },
  "workspace.appearance.densityHint": {
    en: "Spacing in conversations and Markdown content",
    "zh-CN": "会话和 Markdown 内容中的间距",
  },
  "workspace.appearance.density.compact": { en: "Compact", "zh-CN": "紧凑" },
  "workspace.appearance.density.comfortable": { en: "Comfy", "zh-CN": "舒适" },
  "workspace.appearance.density.spacious": { en: "Spacious", "zh-CN": "宽松" },
  "workspace.appearance.threadLayout": { en: "Thread layout", "zh-CN": "线程布局" },
  "workspace.appearance.threadLayout.split": { en: "Split", "zh-CN": "分栏" },
  "workspace.appearance.threadLayout.focus": { en: "Focus", "zh-CN": "聚焦" },
  "workspace.appearance.threadLayout.splitHint": {
    en: "Threads open in a side panel next to the channel",
    "zh-CN": "线程在频道旁的侧边面板中打开",
  },
  "workspace.appearance.threadLayout.focusHint": {
    en: "Threads open over the channel",
    "zh-CN": "线程覆盖在频道上方打开",
  },
  "workspace.appearance.preview": { en: "Preview", "zh-CN": "预览" },
  "workspace.appearance.previewFirst": {
    en: "The revised conversation layout is ready to review.",
    "zh-CN": "调整后的会话布局可以审阅了。",
  },
  "workspace.appearance.previewSecond": {
    en: "Looks good. Spacing reads well at this size.",
    "zh-CN": "看起来不错，这个字号下间距很清晰。",
  },
  "workspace.appearance.previewThird": {
    en: "I'll check it on a phone next.",
    "zh-CN": "接下来我会在手机上检查。",
  },

  "workspace.community.rail": { en: "Communities", "zh-CN": "社区" },
  "workspace.community.switch": { en: "Switch community", "zh-CN": "切换社区" },
  "workspace.community.add": { en: "Add community", "zh-CN": "添加社区" },
  "workspace.community.addAction": { en: "Add and switch", "zh-CN": "添加并切换" },
  "workspace.community.addDescription": {
    en: "Communities are saved in this browser. Your identity stays the same; each community keeps its own drafts, read state and caches.",
    "zh-CN": "社区保存在此浏览器中。身份保持不变；每个社区各自保留草稿、已读状态和缓存。",
  },
  "workspace.community.relayUrl": { en: "Relay URL", "zh-CN": "Relay 地址" },
  "workspace.community.relayUrlPlaceholder": {
    en: "wss://buzz.example.com",
    "zh-CN": "wss://buzz.example.com",
  },
  "workspace.community.name": { en: "Name (optional)", "zh-CN": "名称（可选）" },
  "workspace.community.namePlaceholder": { en: "Community name", "zh-CN": "社区名称" },
  "workspace.community.actions": { en: "Actions for {name}", "zh-CN": "{name} 的操作" },
  "workspace.community.copyUrl": { en: "Copy community URL", "zh-CN": "复制社区地址" },
  "workspace.community.urlCopied": { en: "Community URL copied", "zh-CN": "已复制社区地址" },
  "workspace.community.remove": { en: "Remove from this device", "zh-CN": "从此设备移除" },
  "workspace.community.removeAction": { en: "Remove", "zh-CN": "移除" },
  "workspace.community.removeConfirm": {
    en: "Remove \"{name}\" from this device? Buzz won't contact the relay, so your membership isn't revoked. You can add the community again later.",
    "zh-CN":
      "从此设备移除“{name}”？Buzz 不会联系 Relay，因此你的成员身份不会被撤销。之后可以再次添加该社区。",
  },

  "workspace.inbox.reminders": { en: "Reminders", "zh-CN": "提醒" },
  "workspace.inbox.selectItem": {
    en: "Select an item to see its conversation.",
    "zh-CN": "选择一项以查看其会话。",
  },
  "workspace.inbox.errorTitle": { en: "Inbox couldn't load", "zh-CN": "收件箱无法加载" },
  "workspace.inbox.deniedTitle": {
    en: "The Relay denied access to this Inbox",
    "zh-CN": "Relay 拒绝访问此收件箱",
  },
  "workspace.inbox.emptyUnread": { en: "No unread activity", "zh-CN": "没有未读动态" },
  "workspace.inbox.emptyUnreadHint": {
    en: "Turn off Unread only to see read activity.",
    "zh-CN": "关闭“仅未读”即可查看已读动态。",
  },
  "workspace.inbox.emptyHint": {
    en: "Mentions, thread replies, direct messages and approvals will appear here.",
    "zh-CN": "提及、线程回复、私聊和审批会显示在这里。",
  },
  "workspace.inbox.emptyFilterHint": {
    en: "Switch back to All to see other activity.",
    "zh-CN": "切换回“全部”以查看其他动态。",
  },

  "workspace.approval.title": { en: "Workflow approval", "zh-CN": "工作流审批" },
  "workspace.approval.step": { en: "Step {step}", "zh-CN": "步骤 {step}" },
  "workspace.approval.expires": { en: "Expires {time}", "zh-CN": "{time} 过期" },
  "workspace.approval.expired": {
    en: "This approval request has expired.",
    "zh-CN": "此审批请求已过期。",
  },
  "workspace.approval.submittedGrant": {
    en: "Approval submitted. Waiting for the workflow to record it…",
    "zh-CN": "已提交批准，等待工作流记录…",
  },
  "workspace.approval.submittedDeny": {
    en: "Denial submitted. Waiting for the workflow to record it…",
    "zh-CN": "已提交拒绝，等待工作流记录…",
  },
  "workspace.approval.recorded.granted": { en: "Approval recorded", "zh-CN": "已记录批准" },
  "workspace.approval.recorded.denied": { en: "Denial recorded", "zh-CN": "已记录拒绝" },
  "workspace.approval.recorded.expired": {
    en: "Approval expired before a decision",
    "zh-CN": "审批在决定前已过期",
  },
  "workspace.approval.runState": { en: "Run status: {status}", "zh-CN": "运行状态：{status}" },
  "workspace.approval.run.pending": { en: "Pending", "zh-CN": "待处理" },
  "workspace.approval.run.running": { en: "Running", "zh-CN": "运行中" },
  "workspace.approval.run.waiting_approval": {
    en: "Waiting for approval",
    "zh-CN": "等待审批",
  },
  "workspace.approval.run.completed": { en: "Completed", "zh-CN": "已完成" },
  "workspace.approval.run.failed": { en: "Failed", "zh-CN": "失败" },
  "workspace.approval.run.cancelled": { en: "Cancelled", "zh-CN": "已取消" },
  "workspace.approval.reading": {
    en: "Reading the run state from the Relay…",
    "zh-CN": "正在从 Relay 读取运行状态…",
  },
  "workspace.approval.readError": {
    en: "Couldn't read the run state.",
    "zh-CN": "无法读取运行状态。",
  },
  "workspace.approval.runHidden": {
    en: "This identity can't read the run's state.",
    "zh-CN": "此身份无法读取该运行的状态。",
  },
  "workspace.approval.runUnavailable": {
    en: "Run state isn't available for this request.",
    "zh-CN": "此请求没有可用的运行状态。",
  },
});
