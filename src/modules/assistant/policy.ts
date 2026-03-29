import { AssistantChannel } from "@prisma/client";
import type { SessionUser } from "@/shared/auth/types";

export type AssistantPolicy = {
  canUseAssistant: boolean;
  canRequestActions: boolean;
  canExecuteActions: boolean;
};

export function getAssistantPolicy(
  user: SessionUser,
  channel: AssistantChannel,
): AssistantPolicy {
  void channel;

  return {
    canUseAssistant: user.permissions.includes("assistant.use"),
    canRequestActions: user.permissions.includes("assistant.request_actions"),
    canExecuteActions: user.permissions.includes("assistant.execute_actions"),
  };
}
