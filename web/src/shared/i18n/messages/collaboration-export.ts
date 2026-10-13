import { defineMessages } from "@/shared/i18n/messages/define";

/** Collaboration slice: export copy. Keys use the `collab.export.` prefix. */
export const exportCollabMessages = defineMessages({
  "collab.export.title": { en: "Export", "zh-CN": "导出" },
  "collab.export.intro": {
    en: "Download a zip archive of the channels you choose: the signed relay events plus a readable transcript for each channel.",
    "zh-CN": "下载所选频道的 zip 归档：包含每个频道的已签名中继事件和可读的对话记录。",
  },
  "collab.export.channels": { en: "Channels", "zh-CN": "频道" },
  "collab.export.selectAll": { en: "Select all", "zh-CN": "全选" },
  "collab.export.clearSelection": { en: "Clear", "zh-CN": "清除" },
  "collab.export.private": { en: "Private", "zh-CN": "私有" },
  "collab.export.open": { en: "Open", "zh-CN": "公开" },
  "collab.export.unavailable": {
    en: "Connect to a relay to export channel content.",
    "zh-CN": "连接到中继后才能导出频道内容。",
  },
  "collab.export.noChannels": {
    en: "You haven't joined any channels you can export yet.",
    "zh-CN": "你还没有可导出的频道。",
  },
  "collab.export.dateRange": { en: "Date range", "zh-CN": "日期范围" },
  "collab.export.dateRangeHint": {
    en: "Optional. Leave both empty to export the full history the relay returns.",
    "zh-CN": "可选。两项都留空将导出中继返回的全部历史。",
  },
  "collab.export.from": { en: "From", "zh-CN": "开始日期" },
  "collab.export.to": { en: "To", "zh-CN": "结束日期" },
  "collab.export.rangeInvalid": {
    en: "The start date must be on or before the end date.",
    "zh-CN": "开始日期必须早于或等于结束日期。",
  },
  "collab.export.download": {
    en: "Download archive ({count})",
    "zh-CN": "下载归档（{count}）",
  },
  "collab.export.cancel": { en: "Cancel export", "zh-CN": "取消导出" },
  "collab.export.cancelled": { en: "Export cancelled", "zh-CN": "已取消导出" },
  "collab.export.preparing": { en: "Preparing export…", "zh-CN": "正在准备导出…" },
  "collab.export.progress": {
    en: "Channel {index} of {total} · {name} · {count} events",
    "zh-CN": "第 {index}/{total} 个频道 · {name} · {count} 个事件",
  },
  "collab.export.done": {
    en: "Downloaded {channels} channels with {events} events.",
    "zh-CN": "已下载 {channels} 个频道，共 {events} 个事件。",
  },
  "collab.export.truncated": {
    en: "Some very long channels were cut off at the per-channel limit; narrow the date range to export the rest.",
    "zh-CN": "部分超长频道已在单频道上限处截断；请缩小日期范围以导出其余内容。",
  },
  "collab.export.failed": {
    en: "Export failed. {reason}",
    "zh-CN": "导出失败。{reason}",
  },
  "collab.export.privacyNote": {
    en: "The archive contains only events the relay returned to you for the selected channels. It never includes your private key, encrypted personal state, or other channels.",
    "zh-CN": "归档仅包含中继为所选频道返回给你的事件，绝不包含你的私钥、加密的个人状态或其他频道。",
  },
  "collab.export.identitySeparate": {
    en: "This is not an identity backup. To back up your key, use Settings → Identity.",
    "zh-CN": "这不是身份备份。如需备份密钥，请前往 设置 → 身份。",
  },
  "collab.export.snapshotsPointer": {
    en: "Agent and team snapshots are exported and imported from Agents.",
    "zh-CN": "智能体和团队快照请在“智能体”中导出和导入。",
  },
  "collab.export.transcriptChannelId": { en: "Channel ID", "zh-CN": "频道 ID" },
  "collab.export.transcriptEdited": { en: "(edited)", "zh-CN": "（已编辑）" },
  "collab.export.transcriptDeleted": { en: "[message deleted]", "zh-CN": "[消息已删除]" },
  "collab.export.transcriptReactions": { en: "Reactions", "zh-CN": "回应" },
  "collab.export.transcriptCanvas": { en: "Canvas", "zh-CN": "画布" },
  "collab.export.transcriptEmpty": {
    en: "No messages in this range.",
    "zh-CN": "此范围内没有消息。",
  },
  "collab.export.snapshot.exportAgent": { en: "Export agent snapshot", "zh-CN": "导出智能体快照" },
  "collab.export.snapshot.exportTeam": { en: "Export team snapshot", "zh-CN": "导出团队快照" },
  "collab.export.snapshot.fileFormat": { en: "File format", "zh-CN": "文件格式" },
  "collab.export.snapshot.formatPng": { en: "PNG card", "zh-CN": "PNG 卡片" },
  "collab.export.snapshot.formatJson": { en: "JSON", "zh-CN": "JSON" },
  "collab.export.snapshot.errorExportTooLarge": {
    en: "The snapshot is too large to export (limit {limit} MiB). Use a smaller avatar.",
    "zh-CN": "快照过大，无法导出（上限 {limit} MiB）。请使用更小的头像。",
  },
  "collab.export.snapshot.import": { en: "Import snapshot", "zh-CN": "导入快照" },
  "collab.export.snapshot.errorRead": {
    en: "This snapshot couldn't be read.",
    "zh-CN": "无法读取此快照。",
  },
  "collab.export.snapshot.errorInvalidJson": {
    en: "This file isn't a valid snapshot (problem at {detail}).",
    "zh-CN": "此文件不是有效的快照（问题位置：{detail}）。",
  },
  "collab.export.snapshot.errorNoFormat": {
    en: "This file isn't a Buzz snapshot: it has no format marker.",
    "zh-CN": "此文件不是 Buzz 快照：缺少格式标识。",
  },
  "collab.export.snapshot.errorFormat": {
    en: "Unsupported snapshot format “{format}”.",
    "zh-CN": "不支持的快照格式“{format}”。",
  },
  "collab.export.snapshot.errorVersion": {
    en: "Unsupported snapshot version {version}. Only version 1 can be imported.",
    "zh-CN": "不支持的快照版本 {version}。仅能导入版本 1。",
  },
  "collab.export.snapshot.errorEmptyName": {
    en: "The snapshot has no agent name.",
    "zh-CN": "快照缺少智能体名称。",
  },
  "collab.export.snapshot.fieldDisplayName": { en: "Display name", "zh-CN": "显示名称" },
  "collab.export.snapshot.fieldSystemPrompt": { en: "Agent instructions", "zh-CN": "智能体指令" },
  "collab.export.snapshot.fieldDescription": { en: "Description", "zh-CN": "描述" },
  "collab.export.snapshot.errorTextRequired": {
    en: "{field} is required.",
    "zh-CN": "{field}为必填项。",
  },
  "collab.export.snapshot.errorTextTooLong": {
    en: "{field} is too long (max {max}).",
    "zh-CN": "{field}过长（上限 {max}）。",
  },
  "collab.export.snapshot.errorTextInvisible": {
    en: "{field} contains a prohibited invisible or formatting character ({codePoint}).",
    "zh-CN": "{field}包含禁止使用的不可见或格式字符（{codePoint}）。",
  },
  "collab.export.snapshot.errorAcpCommand": {
    en: "The snapshot names a machine-local ACP command. Only buzz-acp or a portable buzz-*-acp alias is allowed.",
    "zh-CN": "快照包含本机专用的 ACP 命令。仅允许 buzz-acp 或可移植的 buzz-*-acp 别名。",
  },
  "collab.export.snapshot.errorMemory": {
    en: "The snapshot is malformed: memory level is “none” but entries are present.",
    "zh-CN": "快照格式错误：记忆级别为“none”却包含条目。",
  },
  "collab.export.snapshot.errorLocked": {
    en: "This card is locked to its owner and agent. Import it in Buzz Desktop with the owner or agent key.",
    "zh-CN": "此卡片已锁定给其所有者和智能体。请在 Buzz 桌面版中使用所有者或智能体密钥导入。",
  },
  "collab.export.snapshot.errorTooLarge": {
    en: "The snapshot file is too large (limit {limit} MiB).",
    "zh-CN": "快照文件过大（上限 {limit} MiB）。",
  },
  "collab.export.snapshot.errorPngNoChunk": {
    en: "This PNG doesn't contain a Buzz snapshot.",
    "zh-CN": "此 PNG 不包含 Buzz 快照。",
  },
  "collab.export.snapshot.errorPng": {
    en: "This PNG snapshot is damaged and couldn't be read.",
    "zh-CN": "此 PNG 快照已损坏，无法读取。",
  },
  "collab.export.snapshot.errorLegacyTeam": {
    en: "Legacy team files are no longer supported. Export a buzz-team-snapshot v1 .team.json or .team.png instead.",
    "zh-CN":
      "已不再支持旧版团队文件。请改为导出 buzz-team-snapshot v1 的 .team.json 或 .team.png。",
  },
  "collab.export.snapshot.errorTeamName": {
    en: "The team snapshot has no team name.",
    "zh-CN": "团队快照缺少团队名称。",
  },
  "collab.export.snapshot.errorTeamMembers": {
    en: "The team snapshot must have at least one member.",
    "zh-CN": "团队快照至少需要一名成员。",
  },
  "collab.export.snapshot.errorTeamMember": {
    en: "Team member {index}: {reason}",
    "zh-CN": "团队成员 {index}：{reason}",
  },
  "collab.export.snapshot.errorMissingPersona": {
    en: "This team references an agent that isn't loaded, so it can't be exported.",
    "zh-CN": "此团队引用了未加载的智能体，无法导出。",
  },
  "collab.export.snapshot.errorAllowlistPubkey": {
    en: "The snapshot's respond-to allowlist contains an invalid public key.",
    "zh-CN": "快照的回复允许列表包含无效公钥。",
  },
  "collab.export.snapshot.errorAllowlistEmpty": {
    en: "The snapshot responds only to an allowlist, but the allowlist is empty.",
    "zh-CN": "快照仅回复允许列表中的用户，但允许列表为空。",
  },
  "collab.export.snapshot.errorRespondTo": {
    en: "The snapshot uses an unknown respond-to mode “{value}”.",
    "zh-CN": "快照使用了未知的回复模式“{value}”。",
  },
});
