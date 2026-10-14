import { canvasCollabMessages } from "@/shared/i18n/messages/collaboration-canvas";
import { exportCollabMessages } from "@/shared/i18n/messages/collaboration-export";
import { forumsCollabMessages } from "@/shared/i18n/messages/collaboration-forums";
import { pulseCollabMessages } from "@/shared/i18n/messages/collaboration-pulse";
import { remindersCollabMessages } from "@/shared/i18n/messages/collaboration-reminders";

export const collaborationMessages = {
  ...canvasCollabMessages,
  ...forumsCollabMessages,
  ...remindersCollabMessages,
  ...pulseCollabMessages,
  ...exportCollabMessages,
} as const;
