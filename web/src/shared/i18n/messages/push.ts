import { defineMessages } from "@/shared/i18n/messages/define";

export const pushMessages = defineMessages({
  "push.title": { en: "Notifications", "zh-CN": "通知" },
  "push.description": {
    en: "Get browser notifications for mentions and direct messages in this community, even when Buzz is closed.",
    "zh-CN": "即使 Buzz 已关闭，也能在浏览器中收到此社区的提及和私信通知。",
  },
  "push.statusOn": { en: "On", "zh-CN": "已开启" },
  "push.statusOff": { en: "Off", "zh-CN": "已关闭" },
  "push.statusBlocked": { en: "Blocked", "zh-CN": "已阻止" },
  "push.statusUnavailable": { en: "Unavailable", "zh-CN": "不可用" },
  "push.statusLabel": { en: "Background notifications", "zh-CN": "后台通知" },
  "push.unsupported": {
    en: "This browser does not support background notifications.",
    "zh-CN": "此浏览器不支持后台通知。",
  },
  "push.insecure": {
    en: "Background notifications need a secure (HTTPS) connection to Buzz.",
    "zh-CN": "后台通知需要通过安全（HTTPS）连接访问 Buzz。",
  },
  "push.relayUnsupported": {
    en: "This community's relay does not offer browser notifications.",
    "zh-CN": "此社区的中继不提供浏览器通知。",
  },
  "push.checking": { en: "Checking notification support…", "zh-CN": "正在检查通知支持…" },
  "push.blocked": {
    en: "Notifications are blocked for this site. Allow them in your browser's site settings, then turn them on here.",
    "zh-CN": "此网站的通知已被阻止。请在浏览器的网站设置中允许通知，然后在此开启。",
  },
  "push.enable": { en: "Turn on notifications", "zh-CN": "开启通知" },
  "push.disable": { en: "Turn off notifications", "zh-CN": "关闭通知" },
  "push.enabling": { en: "Turning on…", "zh-CN": "正在开启…" },
  "push.disabling": { en: "Turning off…", "zh-CN": "正在关闭…" },
  "push.activeDescription": {
    en: "This browser receives notifications for this community while Buzz is closed.",
    "zh-CN": "Buzz 关闭时，此浏览器仍会收到此社区的通知。",
  },
  "push.offDescription": {
    en: "Turning this on asks your browser for permission and registers this browser with the community relay.",
    "zh-CN": "开启后将请求浏览器通知权限，并在社区中继登记此浏览器。",
  },
  "push.stale": {
    en: "Notifications stopped on this browser because its push subscription was replaced or removed. Turn them on again to resume.",
    "zh-CN": "此浏览器的推送订阅已被替换或移除，通知已停止。重新开启即可恢复。",
  },
  "push.mentionsAlways": {
    en: "Mentions of you always notify, even in muted channels. Muting a channel stops its other messages; your own messages never notify.",
    "zh-CN":
      "提及你的消息总会通知，包括已静音的频道。静音频道会停止其他消息的通知；你自己的消息不会通知。",
  },
  "push.directMessages": { en: "Direct messages", "zh-CN": "私信" },
  "push.directMessagesHint": {
    en: "Notify for every message in your direct messages",
    "zh-CN": "私信中的每条消息都通知",
  },
  "push.channels": { en: "Channels", "zh-CN": "频道" },
  "push.channelsHint": {
    en: "Notify for every message in the channels you select",
    "zh-CN": "所选频道中的每条消息都通知",
  },
  "push.noChannels": {
    en: "Join a channel to choose it here.",
    "zh-CN": "加入频道后即可在此选择。",
  },
  "push.lastReceived": {
    en: "Last notification received {time}",
    "zh-CN": "最近一次收到通知：{time}",
  },
  "push.enabledToast": { en: "Notifications turned on", "zh-CN": "通知已开启" },
  "push.disabledToast": { en: "Notifications turned off", "zh-CN": "通知已关闭" },
  "push.updatedToast": { en: "Notification choices saved", "zh-CN": "通知选项已保存" },
  "push.notificationTitle": { en: "New activity in {community}", "zh-CN": "{community} 有新动态" },
  "push.notificationBody": {
    en: "Open Buzz to read it.",
    "zh-CN": "打开 Buzz 查看。",
  },
  "push.errorPermission": {
    en: "Notification permission was not granted.",
    "zh-CN": "未获得通知权限。",
  },
  "push.errorRelayInfo": {
    en: "Could not read the relay's notification settings ({status}).",
    "zh-CN": "无法读取中继的通知设置（{status}）。",
  },
  "push.errorTooManyChannels": {
    en: "Too many channels are selected for notifications. Deselect some and try again.",
    "zh-CN": "选择的通知频道过多，请取消部分频道后重试。",
  },
  "push.errorUpdate": {
    en: "Could not update notifications.",
    "zh-CN": "无法更新通知设置。",
  },
  "push.linkOtherCommunity": {
    en: "That notification belongs to another community ({community}). Open that community to view it.",
    "zh-CN": "该通知属于另一个社区（{community}）。请打开该社区查看。",
  },
  "push.linkNoAccess": {
    en: "You can't open that conversation with the current identity.",
    "zh-CN": "当前身份无法打开该对话。",
  },
  "push.linkMissing": {
    en: "The message from that notification is no longer available.",
    "zh-CN": "该通知对应的消息已不可用。",
  },
  "push.retiredForeign": {
    en: "Background notifications for a previously signed-in identity were turned off on this browser.",
    "zh-CN": "已在此浏览器上关闭之前登录身份的后台通知。",
  },
});
