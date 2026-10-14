import { defineMessages } from "@/shared/i18n/messages/define";

export const voiceMessages = defineMessages({
  "voice.recordNote": { en: "Record voice note", "zh-CN": "录制语音消息" },
  "voice.discardNote": { en: "Discard voice note", "zh-CN": "放弃语音消息" },
  "voice.finishNote": { en: "Finish voice note", "zh-CN": "完成语音消息" },
  "voice.requestingMicrophone": { en: "Waiting for microphone…", "zh-CN": "正在等待麦克风…" },
  "voice.preparingNote": { en: "Preparing…", "zh-CN": "正在处理…" },
  "voice.recordingElapsed": { en: "Recording {time}", "zh-CN": "录音中 {time}" },
  "voice.recordingRemaining": { en: "{time} left", "zh-CN": "剩余 {time}" },
  "voice.playNote": { en: "Play voice note", "zh-CN": "播放语音消息" },
  "voice.pauseNote": { en: "Pause voice note", "zh-CN": "暂停语音消息" },
  "voice.removeNote": { en: "Remove voice note", "zh-CN": "移除语音消息" },
  "voice.noteLabel": { en: "Voice note", "zh-CN": "语音消息" },
  "voice.noteUnavailable": {
    en: "Voice note unavailable",
    "zh-CN": "语音消息无法加载",
  },

  "voice.startHuddle": { en: "Start huddle", "zh-CN": "发起语音通话" },
  "voice.joinHuddle": { en: "Join huddle", "zh-CN": "加入语音通话" },
  "voice.huddleActive": {
    en: "Huddle active · {count} in call",
    "zh-CN": "语音通话进行中 · {count} 人",
  },
  "voice.huddleInChannel": { en: "Huddle in #{channel}", "zh-CN": "#{channel} 中的语音通话" },
  "voice.huddleTitle": { en: "Huddle", "zh-CN": "语音通话" },
  "voice.openHuddleChannel": { en: "Open #{channel}", "zh-CN": "打开 #{channel}" },
  "voice.phase.starting": { en: "Starting…", "zh-CN": "正在发起…" },
  "voice.phase.joining": { en: "Connecting…", "zh-CN": "正在连接…" },
  "voice.phase.connected": { en: "Connected", "zh-CN": "已连接" },
  "voice.phase.reconnecting": { en: "Reconnecting…", "zh-CN": "正在重新连接…" },
  "voice.leaveHuddle": { en: "Leave huddle", "zh-CN": "离开语音通话" },
  "voice.leave": { en: "Leave", "zh-CN": "离开" },
  "voice.muteMicrophone": { en: "Mute microphone", "zh-CN": "静音麦克风" },
  "voice.unmuteMicrophone": { en: "Unmute microphone", "zh-CN": "取消麦克风静音" },
  "voice.microphoneUnavailable": { en: "Microphone unavailable", "zh-CN": "麦克风不可用" },
  "voice.retryMicrophone": { en: "Retry microphone", "zh-CN": "重试麦克风" },
  "voice.deafen": { en: "Mute incoming audio", "zh-CN": "关闭通话声音" },
  "voice.undeafen": { en: "Unmute incoming audio", "zh-CN": "开启通话声音" },
  "voice.audioSettings": { en: "Audio settings", "zh-CN": "音频设置" },
  "voice.microphone": { en: "Microphone", "zh-CN": "麦克风" },
  "voice.speaker": { en: "Speaker", "zh-CN": "扬声器" },
  "voice.systemDefault": { en: "System default", "zh-CN": "系统默认" },
  "voice.unnamedDevice": { en: "Audio device {index}", "zh-CN": "音频设备 {index}" },
  "voice.outputFixed": {
    en: "This browser always plays through the system default output.",
    "zh-CN": "此浏览器只能通过系统默认输出设备播放。",
  },
  "voice.participants": { en: "Huddle participants", "zh-CN": "语音通话参与者" },
  "voice.participantSelf": { en: "{name} (you)", "zh-CN": "{name}（你）" },
  "voice.speaking": { en: "Speaking", "zh-CN": "正在说话" },
  "voice.muted": { en: "Muted", "zh-CN": "已静音" },
  "voice.reactions": { en: "Emoji reactions", "zh-CN": "表情回应" },
  "voice.react": { en: "React with {emoji}", "zh-CN": "用 {emoji} 回应" },
  "voice.reactionFrom": { en: "{name} reacted {emoji}", "zh-CN": "{name} 回应了 {emoji}" },
  "voice.reactionFailed": {
    en: "Couldn't send the reaction.",
    "zh-CN": "无法发送表情回应。",
  },
  "voice.dismissError": { en: "Dismiss", "zh-CN": "关闭" },

  "voice.error.denied": {
    en: "Microphone access is blocked. Allow it in your browser's site settings, then try again.",
    "zh-CN": "麦克风权限被阻止。请在浏览器的网站设置中允许后重试。",
  },
  "voice.error.notFound": {
    en: "No microphone was found. Connect one and try again.",
    "zh-CN": "未找到麦克风。请连接麦克风后重试。",
  },
  "voice.error.busy": {
    en: "The microphone couldn't start. Close other apps using it and try again.",
    "zh-CN": "麦克风无法启动。请关闭正在使用它的其他应用后重试。",
  },
  "voice.error.insecure": {
    en: "Microphone access needs a secure (HTTPS) connection.",
    "zh-CN": "使用麦克风需要安全的 HTTPS 连接。",
  },
  "voice.error.unavailable": {
    en: "This browser can't capture audio here.",
    "zh-CN": "此浏览器无法在这里录制音频。",
  },
  "voice.error.empty": {
    en: "The recording was empty. Try recording again.",
    "zh-CN": "录音为空，请重新录制。",
  },
  "voice.error.interrupted": {
    en: "The microphone stopped during recording. The part recorded so far was kept.",
    "zh-CN": "录音时麦克风中断，已保留已录制的部分。",
  },
  "voice.error.deviceLost": {
    en: "Your microphone was disconnected, so others can't hear you. Choose another microphone or retry.",
    "zh-CN": "麦克风已断开，其他人听不到你。请选择其他麦克风或重试。",
  },
  "voice.error.revoked": {
    en: "You were removed from this channel, so you left the huddle.",
    "zh-CN": "你已被移出此频道，因此已离开语音通话。",
  },
  "voice.error.ended": { en: "This huddle has ended.", "zh-CN": "此语音通话已结束。" },
  "voice.error.full": { en: "This huddle is full.", "zh-CN": "此语音通话人数已满。" },
  "voice.error.unsupported": {
    en: "This relay doesn't offer huddle audio for this client.",
    "zh-CN": "此中继暂不为此客户端提供语音通话音频。",
  },
  "voice.error.notMember": {
    en: "You're not a member of this channel, so you can't join its huddle.",
    "zh-CN": "你不是此频道的成员，无法加入语音通话。",
  },
  "voice.error.auth": {
    en: "The relay rejected the huddle sign-in. Try joining again.",
    "zh-CN": "中继拒绝了语音通话认证，请重新加入。",
  },
  "voice.error.codec": {
    en: "This browser can't encode or decode Opus audio.",
    "zh-CN": "此浏览器无法编码或解码 Opus 音频。",
  },
  "voice.error.connection": {
    en: "The huddle connection was lost. Join again when you're back online.",
    "zh-CN": "语音通话连接已断开。恢复网络后请重新加入。",
  },
  "voice.error.start": {
    en: "Couldn't start the huddle. Try again.",
    "zh-CN": "无法发起语音通话，请重试。",
  },
  "voice.error.join": {
    en: "Couldn't join the huddle. Try again.",
    "zh-CN": "无法加入语音通话，请重试。",
  },
});
