import { agentsMessages } from "@/shared/i18n/messages/agents";
import { collaborationMessages } from "@/shared/i18n/messages/collaboration";
import { composerMessages } from "@/shared/i18n/messages/composer";
import { projectsMessages } from "@/shared/i18n/messages/projects";
import { pushMessages } from "@/shared/i18n/messages/push";
import { remoteMessages } from "@/shared/i18n/messages/remote";
import { voiceMessages } from "@/shared/i18n/messages/voice";
import { workflowsMessages } from "@/shared/i18n/messages/workflows";
import { workspaceMessages } from "@/shared/i18n/messages/workspace";

export const featureMessages = {
  ...workspaceMessages,
  ...composerMessages,
  ...collaborationMessages,
  ...agentsMessages,
  ...projectsMessages,
  ...workflowsMessages,
  ...voiceMessages,
  ...pushMessages,
  ...remoteMessages,
} as const;
