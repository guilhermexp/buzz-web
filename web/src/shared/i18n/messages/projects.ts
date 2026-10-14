import { defineMessages } from "@/shared/i18n/messages/define";

export const projectsMessages = defineMessages({
  "projects.loading": { en: "Loading", "zh-CN": "正在加载" },
  "projects.notFound": {
    en: "Project not found on this Relay.",
    "zh-CN": "当前 Relay 上找不到该项目。",
  },
  "projects.noDescription": { en: "No description provided.", "zh-CN": "未提供描述。" },
  "projects.openedAt": { en: "opened {time}", "zh-CN": "创建于 {time}" },
  "projects.openChannelNamed": { en: "Open #{channel}", "zh-CN": "打开 #{channel}" },
  "projects.createdProject": {
    en: "{actor} published project {project}",
    "zh-CN": "{actor} 发布了项目 {project}",
  },
  "projects.stats.projects": { en: "Projects", "zh-CN": "项目" },
  "projects.stats.openPullRequests": { en: "Open pull requests", "zh-CN": "未关闭的 Pull Request" },
  "projects.stats.openIssues": { en: "Open issues", "zh-CN": "未关闭的 Issue" },
  "projects.status.open": { en: "Open", "zh-CN": "开放" },
  "projects.status.draft": { en: "Draft", "zh-CN": "草稿" },
  "projects.status.closed": { en: "Closed", "zh-CN": "已关闭" },
  "projects.status.merged": { en: "Merged", "zh-CN": "已合并" },
  "projects.list.open": { en: "{count} open", "zh-CN": "{count} 个开放" },
  "projects.list.closed": { en: "{count} closed", "zh-CN": "{count} 个已关闭" },
  "projects.workItem.notFound": {
    en: "This item is not available on this Relay.",
    "zh-CN": "当前 Relay 上找不到该条目。",
  },
  "projects.tree.up": { en: "Parent folder", "zh-CN": "上级目录" },
  "projects.commit.mergeParents": { en: "Merge of {parents}", "zh-CN": "合并自 {parents}" },

  "projects.create.open": { en: "Publish a project", "zh-CN": "发布项目" },
  "projects.create.title": { en: "Publish a project", "zh-CN": "发布项目" },
  "projects.create.description": {
    en: "Creates a project and its first repository, both bound to a channel. Channel members can clone and push branches.",
    "zh-CN": "创建一个项目及其首个仓库，并绑定到频道。频道成员可以克隆并推送分支。",
  },
  "projects.create.submit": { en: "Publish project", "zh-CN": "发布项目" },
  "projects.create.done": { en: "Project published.", "zh-CN": "项目已发布。" },
  "projects.create.exists": {
    en: "You already have a project named “{name}”.",
    "zh-CN": "你已有名为“{name}”的项目。",
  },
  "projects.field.name": { en: "Name", "zh-CN": "名称" },
  "projects.field.identifier": { en: "Identifier: {id}", "zh-CN": "标识符：{id}" },
  "projects.field.title": { en: "Title", "zh-CN": "标题" },
  "projects.field.description": { en: "Description", "zh-CN": "描述" },
  "projects.field.labels": { en: "Labels", "zh-CN": "标签" },
  "projects.field.labelsHint": { en: "Comma-separated, optional", "zh-CN": "以逗号分隔，可选" },
  "projects.field.channel": { en: "Access channel", "zh-CN": "访问频道" },
  "projects.field.chooseChannel": { en: "Choose a channel", "zh-CN": "选择频道" },
  "projects.field.channelHint": {
    en: "Git clone and push access follows membership of this channel.",
    "zh-CN": "Git 克隆和推送权限取决于该频道的成员身份。",
  },
  "projects.field.visibility": { en: "Listing", "zh-CN": "列出方式" },
  "projects.field.listed": { en: "Listed", "zh-CN": "公开列出" },
  "projects.field.unlisted": { en: "Unlisted", "zh-CN": "不公开列出" },

  "projects.repo.add": { en: "Add repository", "zh-CN": "添加仓库" },
  "projects.repo.addTitle": {
    en: "Add a repository to {project}",
    "zh-CN": "向 {project} 添加仓库",
  },
  "projects.repo.addMode": { en: "How to add the repository", "zh-CN": "添加仓库的方式" },
  "projects.repo.newTab": { en: "New repository", "zh-CN": "新建仓库" },
  "projects.repo.create": { en: "Create repository", "zh-CN": "创建仓库" },
  "projects.repo.added": { en: "Repository added to the project.", "zh-CN": "仓库已添加到项目。" },
  "projects.repo.exists": {
    en: "You already have a repository named “{name}”. Import it instead.",
    "zh-CN": "你已有名为“{name}”的仓库，请改为导入。",
  },
  "projects.repo.none": {
    en: "This project has no repositories yet.",
    "zh-CN": "该项目还没有仓库。",
  },
  "projects.repo.unavailable": {
    en: "{count} listed repositories are not announced on this Relay.",
    "zh-CN": "{count} 个列出的仓库未在当前 Relay 上发布。",
  },
  "projects.repo.counts": {
    en: "{prs} open pull requests · {issues} open issues",
    "zh-CN": "{prs} 个开放 Pull Request · {issues} 个开放 Issue",
  },
  "projects.repo.protections": { en: "Branch protection", "zh-CN": "分支保护" },
  "projects.repo.emptyPushHint": {
    en: "No branches yet. Push a first commit with git using git-credential-nostr for NIP-98 authentication.",
    "zh-CN":
      "还没有分支。请使用 git 并通过 git-credential-nostr 进行 NIP-98 认证来推送第一个提交。",
  },
  "projects.import.tab": { en: "Import existing", "zh-CN": "导入已有仓库" },
  "projects.import.choose": { en: "Your repositories", "zh-CN": "你的仓库" },
  "projects.import.choosePlaceholder": { en: "Choose a repository", "zh-CN": "选择仓库" },
  "projects.import.coordinate": { en: "Repository address", "zh-CN": "仓库地址" },
  "projects.import.placeholder": { en: "30617:<owner>:<repo>", "zh-CN": "30617:<所有者>:<仓库>" },
  "projects.import.hint": {
    en: "A kind 30617 address you own or maintain. Its announcement and clone remotes stay unchanged.",
    "zh-CN": "你拥有或维护的 kind 30617 地址。其公告和克隆远程地址保持不变。",
  },
  "projects.import.submit": { en: "Import repository", "zh-CN": "导入仓库" },
  "projects.import.notFound": {
    en: "No repository with that address is announced on this Relay.",
    "zh-CN": "当前 Relay 上没有发布该地址的仓库。",
  },
  "projects.import.notMaintainer": {
    en: "Projects can only include repositories you own or maintain.",
    "zh-CN": "项目只能包含你拥有或维护的仓库。",
  },

  "projects.comments.count": { en: "{count} comments", "zh-CN": "{count} 条评论" },
  "projects.comments.placeholder": { en: "Leave a comment", "zh-CN": "发表评论" },
  "projects.comments.submit": { en: "Comment", "zh-CN": "评论" },
  "projects.comments.posted": { en: "Comment posted.", "zh-CN": "评论已发布。" },

  "projects.issue.new": { en: "New issue", "zh-CN": "新建 Issue" },
  "projects.issue.submit": { en: "Submit issue", "zh-CN": "提交 Issue" },
  "projects.issue.created": { en: "Issue opened.", "zh-CN": "Issue 已创建。" },
  "projects.issue.close": { en: "Close issue", "zh-CN": "关闭 Issue" },
  "projects.issue.closed": { en: "Issue closed.", "zh-CN": "Issue 已关闭。" },
  "projects.issue.reopen": { en: "Reopen issue", "zh-CN": "重新打开 Issue" },
  "projects.issue.reopened": { en: "Issue reopened.", "zh-CN": "Issue 已重新打开。" },
  "projects.issue.emptyOpen": { en: "No open issues.", "zh-CN": "没有开放的 Issue。" },
  "projects.issue.emptyClosed": { en: "No closed issues.", "zh-CN": "没有已关闭的 Issue。" },

  "projects.pr.new": { en: "New pull request", "zh-CN": "新建 Pull Request" },
  "projects.pr.submit": { en: "Open pull request", "zh-CN": "创建 Pull Request" },
  "projects.pr.created": { en: "Pull request opened.", "zh-CN": "Pull Request 已创建。" },
  "projects.pr.emptyOpen": { en: "No open pull requests.", "zh-CN": "没有开放的 Pull Request。" },
  "projects.pr.emptyClosed": {
    en: "No closed or merged pull requests.",
    "zh-CN": "没有已关闭或已合并的 Pull Request。",
  },
  "projects.pr.targetBranch": { en: "Base branch", "zh-CN": "目标分支" },
  "projects.pr.sourceBranch": { en: "Compare branch", "zh-CN": "比较分支" },
  "projects.pr.chooseBranch": { en: "Choose a branch", "zh-CN": "选择分支" },
  "projects.pr.noBranches": {
    en: "Push a branch other than the base branch to this repository first.",
    "zh-CN": "请先向该仓库推送一个不同于目标分支的分支。",
  },
  "projects.pr.branches": { en: "{source} → {target}", "zh-CN": "{source} → {target}" },
  "projects.pr.mergedAs": { en: "merged as {commit}", "zh-CN": "已合并为 {commit}" },
  "projects.pr.sections": { en: "Pull request sections", "zh-CN": "Pull Request 分区" },
  "projects.pr.conversation": { en: "Conversation", "zh-CN": "讨论" },
  "projects.pr.files": { en: "Files changed", "zh-CN": "文件变更" },
  "projects.pr.revision": { en: "Revision", "zh-CN": "修订" },
  "projects.pr.revisionOption": {
    en: "Revision {number} · {commit}",
    "zh-CN": "修订 {number} · {commit}",
  },
  "projects.pr.revisionCurrent": {
    en: "Revision {number} · {commit} (current)",
    "zh-CN": "修订 {number} · {commit}（当前）",
  },
  "projects.pr.revisionPushed": {
    en: "pushed revision {commit} {time}",
    "zh-CN": "{time}推送了修订 {commit}",
  },
  "projects.pr.updateRevision": { en: "Update to branch tip", "zh-CN": "更新到分支最新提交" },
  "projects.pr.upToDate": {
    en: "The pull request already points at the branch tip.",
    "zh-CN": "Pull Request 已指向分支最新提交。",
  },
  "projects.pr.updated": { en: "Revision {commit} published.", "zh-CN": "修订 {commit} 已发布。" },
  "projects.pr.markReady": { en: "Ready for review", "zh-CN": "准备好审阅" },
  "projects.pr.markedReady": { en: "Marked as ready for review.", "zh-CN": "已标记为准备好审阅。" },
  "projects.pr.convertDraft": { en: "Convert to draft", "zh-CN": "转为草稿" },
  "projects.pr.convertedDraft": { en: "Converted to draft.", "zh-CN": "已转为草稿。" },
  "projects.pr.close": { en: "Close pull request", "zh-CN": "关闭 Pull Request" },
  "projects.pr.closed": { en: "Pull request closed.", "zh-CN": "Pull Request 已关闭。" },
  "projects.pr.reopen": { en: "Reopen pull request", "zh-CN": "重新打开 Pull Request" },
  "projects.pr.reopened": { en: "Pull request reopened.", "zh-CN": "Pull Request 已重新打开。" },

  "projects.review.title": { en: "Review", "zh-CN": "审阅" },
  "projects.review.summary": {
    en: "{approvals} approvals · {changes} change requests on {commit}",
    "zh-CN": "{commit} 上有 {approvals} 个批准 · {changes} 个修改请求",
  },
  "projects.review.reviewers": { en: "Reviewers", "zh-CN": "审阅者" },
  "projects.review.summaryPlaceholder": {
    en: "Review summary (optional)",
    "zh-CN": "审阅摘要（可选）",
  },
  "projects.review.appliesTo": {
    en: "Your decision applies to revision {commit}.",
    "zh-CN": "你的决定适用于修订 {commit}。",
  },
  "projects.review.approve": { en: "Approve", "zh-CN": "批准" },
  "projects.review.requestChanges": { en: "Request changes", "zh-CN": "请求修改" },
  "projects.review.approved": { en: "Review approved.", "zh-CN": "已批准。" },
  "projects.review.changesRequested": { en: "Changes requested.", "zh-CN": "已请求修改。" },
  "projects.review.approvedBadge": { en: "Approved", "zh-CN": "已批准" },
  "projects.review.changesBadge": { en: "Changes requested", "zh-CN": "请求修改" },
  "projects.review.requestBadge": { en: "Review requested", "zh-CN": "已请求审阅" },
  "projects.review.currentRevision": {
    en: "on {commit} · current",
    "zh-CN": "针对 {commit} · 当前",
  },
  "projects.review.historicalRevision": {
    en: "on {commit} · earlier revision",
    "zh-CN": "针对 {commit} · 早期修订",
  },
  "projects.review.chooseReviewer": { en: "Choose a reviewer", "zh-CN": "选择审阅者" },
  "projects.review.request": { en: "Request review", "zh-CN": "请求审阅" },
  "projects.review.requested": { en: "Review requested.", "zh-CN": "已请求审阅。" },
  "projects.review.commentOnLine": { en: "Comment on this line", "zh-CN": "评论此行" },
  "projects.review.inlinePlaceholder": {
    en: "Inline review comment",
    "zh-CN": "行内审阅评论",
  },
  "projects.review.inlineTarget": {
    en: "{path}:{line} at {commit}",
    "zh-CN": "{path}:{line}（{commit}）",
  },
  "projects.review.addComment": { en: "Add comment", "zh-CN": "添加评论" },

  "projects.diff.title": { en: "Changed files", "zh-CN": "变更文件" },
  "projects.diff.summary": {
    en: "{count} files changed between {base} and {head}",
    "zh-CN": "{base} 与 {head} 之间有 {count} 个文件变更",
  },
  "projects.diff.layout": { en: "Diff layout", "zh-CN": "差异布局" },
  "projects.diff.unified": { en: "Unified", "zh-CN": "合并视图" },
  "projects.diff.split": { en: "Split", "zh-CN": "分栏视图" },
  "projects.diff.empty": {
    en: "This revision has no changes against its merge base.",
    "zh-CN": "该修订与合并基础之间没有变更。",
  },
  "projects.diff.binary": { en: "Binary file not shown.", "zh-CN": "未显示二进制文件。" },
  "projects.diff.tooLarge": {
    en: "File too large to diff here.",
    "zh-CN": "文件过大，无法在此显示差异。",
  },
  "projects.diff.added": { en: "added", "zh-CN": "新增" },
  "projects.diff.deleted": { en: "deleted", "zh-CN": "删除" },
  "projects.diff.modified": { en: "modified", "zh-CN": "修改" },
  "projects.diff.renamed": { en: "renamed", "zh-CN": "重命名" },

  "projects.merge.title": { en: "Merge", "zh-CN": "合并" },
  "projects.merge.description": {
    en: "Merges revision {commit} into {target} in your browser and pushes it with your key. The Relay enforces branch protection.",
    "zh-CN":
      "在浏览器中将修订 {commit} 合并到 {target}，并使用你的密钥推送。Relay 会执行分支保护规则。",
  },
  "projects.merge.action": { en: "Merge", "zh-CN": "合并" },
  "projects.merge.confirm": { en: "Merge into {target}", "zh-CN": "合并到 {target}" },
  "projects.merge.running": { en: "Merging…", "zh-CN": "正在合并…" },
  "projects.merge.done": { en: "Merged as {commit}.", "zh-CN": "已合并为 {commit}。" },
  "projects.merge.incomplete": {
    en: "This pull request is missing its branch or revision, so it cannot be merged here.",
    "zh-CN": "该 Pull Request 缺少分支或修订信息，无法在此合并。",
  },
  "projects.merge.rejected": {
    en: "The Relay rejected the push to {target}.",
    "zh-CN": "Relay 拒绝了对 {target} 的推送。",
  },
  "projects.merge.notMerged": {
    en: "Nothing was merged: the target branch is unchanged and no merged status was published.",
    "zh-CN": "未进行任何合并：目标分支保持不变，也未发布已合并状态。",
  },
  "projects.merge.statusPending": {
    en: "{target} now points at {commit}, but the merged status was not published yet.",
    "zh-CN": "{target} 已指向 {commit}，但已合并状态尚未发布。",
  },
  "projects.merge.publishStatus": { en: "Publish merged status", "zh-CN": "发布已合并状态" },

  "projects.git.branchMissing": {
    en: "The branch does not exist on the remote.",
    "zh-CN": "远程仓库中不存在该分支。",
  },
  "projects.git.branchChanged": {
    en: "The branch moved since this revision was published. Update the pull request first.",
    "zh-CN": "该分支在此修订发布后已变动，请先更新 Pull Request。",
  },
  "projects.git.revisionUnavailable": {
    en: "This revision is no longer available from its clone URL.",
    "zh-CN": "无法再从克隆地址获取该修订。",
  },
  "projects.git.mergeConflict": {
    en: "The revision conflicts with the target branch. Resolve it locally and update the pull request.",
    "zh-CN": "该修订与目标分支冲突。请在本地解决后更新 Pull Request。",
  },
  "projects.git.pushRejected": {
    en: "The Relay rejected the push.",
    "zh-CN": "Relay 拒绝了推送。",
  },
  "projects.git.pushUnverified": {
    en: "The push finished but the branch does not show the merge commit.",
    "zh-CN": "推送已完成，但分支未显示合并提交。",
  },
  "projects.git.transport": { en: "Git request failed.", "zh-CN": "Git 请求失败。" },

  "projects.error.generic": {
    en: "The request could not be completed.",
    "zh-CN": "无法完成请求。",
  },
  "projects.error.relay": { en: "Not connected to the Relay.", "zh-CN": "未连接到 Relay。" },
  "projects.error.repoId": {
    en: "Names need letters or numbers (64 characters at most).",
    "zh-CN": "名称需包含字母或数字（最多 64 个字符）。",
  },
  "projects.error.nameRequired": { en: "Enter a name.", "zh-CN": "请输入名称。" },
  "projects.error.nameLength": { en: "The name is too long.", "zh-CN": "名称过长。" },
  "projects.error.descriptionLength": { en: "The description is too long.", "zh-CN": "描述过长。" },
  "projects.error.channel": {
    en: "Choose a channel you belong to.",
    "zh-CN": "请选择你所在的频道。",
  },
  "projects.error.cloneUrls": {
    en: "Clone URLs must be http(s), at most 5.",
    "zh-CN": "克隆地址必须为 http(s)，最多 5 个。",
  },
  "projects.error.cloneMissing": {
    en: "This repository has no clone URL.",
    "zh-CN": "该仓库没有克隆地址。",
  },
  "projects.error.notProjectOwner": {
    en: "Only the project owner can change its repositories.",
    "zh-CN": "只有项目所有者可以修改其仓库。",
  },
  "projects.error.repoAddress": {
    en: "Use a repository address like 30617:<owner>:<repo>.",
    "zh-CN": "请使用形如 30617:<owner>:<repo> 的仓库地址。",
  },
  "projects.error.memberExists": {
    en: "The project already includes this repository.",
    "zh-CN": "项目已包含该仓库。",
  },
  "projects.error.memberCap": {
    en: "A project can include at most 64 repositories.",
    "zh-CN": "一个项目最多包含 64 个仓库。",
  },
  "projects.error.titleRequired": { en: "Enter a title.", "zh-CN": "请输入标题。" },
  "projects.error.titleLength": {
    en: "Titles are limited to 256 characters.",
    "zh-CN": "标题最多 256 个字符。",
  },
  "projects.error.branchSame": {
    en: "Choose a compare branch different from the base branch.",
    "zh-CN": "请选择与目标分支不同的比较分支。",
  },
  "projects.error.commit": {
    en: "The revision commit is missing or invalid.",
    "zh-CN": "修订提交缺失或无效。",
  },
  "projects.error.reviewers": { en: "Choose a valid reviewer.", "zh-CN": "请选择有效的审阅者。" },
  "projects.error.commentEmpty": { en: "Write a comment first.", "zh-CN": "请先填写评论。" },
  "projects.error.anchor": { en: "That line cannot be commented on.", "zh-CN": "无法评论该行。" },
});
