import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "@/shared/config/env";
import {
  createCodexCookieFromSessionId,
  getCodexSessionIdFromCookie,
  isCodexAuthenticated,
} from "@/shared/config/codex-auth";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";

type SharedWhatsAppAssistantProvider = {
  provider: "codex";
  sessionId: string;
  configuredAt: string;
  configuredByUserId: string;
};

type AssistantProviderConfig = {
  whatsAppAssistant?: SharedWhatsAppAssistantProvider;
};

function getAssistantProviderConfigPath() {
  return join(process.cwd(), env.databaseDir, "assistant-provider.json");
}

async function readAssistantProviderConfig(): Promise<AssistantProviderConfig> {
  const filePath = getAssistantProviderConfigPath();

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as AssistantProviderConfig;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }
}

async function writeAssistantProviderConfig(config: AssistantProviderConfig) {
  const filePath = getAssistantProviderConfigPath();
  await mkdir(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(config, null, 2), "utf-8");
  await rename(tempPath, filePath);
}

export async function getWhatsAppAssistantProviderStatus() {
  if (env.openAiApiKey) {
    return {
      mode: "api_key" as const,
      ready: true,
      configuredAt: null,
      configuredByUserId: null,
    };
  }

  const config = await readAssistantProviderConfig();
  const sharedProvider = config.whatsAppAssistant;

  if (!sharedProvider?.sessionId) {
    return {
      mode: "codex" as const,
      ready: false,
      configuredAt: null,
      configuredByUserId: null,
    };
  }

  const cookieValue = createCodexCookieFromSessionId(sharedProvider.sessionId);
  return {
    mode: "codex" as const,
    ready: await isCodexAuthenticated(cookieValue),
    configuredAt: sharedProvider.configuredAt,
    configuredByUserId: sharedProvider.configuredByUserId,
  };
}

export async function getSharedWhatsAppAssistantCodexCookie() {
  if (env.openAiApiKey) {
    return undefined;
  }

  const config = await readAssistantProviderConfig();
  const sharedProvider = config.whatsAppAssistant;
  if (!sharedProvider?.sessionId) {
    return undefined;
  }

  return createCodexCookieFromSessionId(sharedProvider.sessionId);
}

export async function configureWhatsAppAssistantProviderFromCookie(input: {
  cookieValue: string | undefined;
  configuredByUserId: string;
}) {
  if (env.openAiApiKey) {
    return getWhatsAppAssistantProviderStatus();
  }

  const sessionId = getCodexSessionIdFromCookie(input.cookieValue);
  if (!sessionId) {
    throw new BusinessRuleError(
      "CODEX_NOT_CONNECTED",
      "Συνδέσου πρώτα με OpenAI για να ενεργοποιήσεις τον assistant στο WhatsApp.",
      401,
    );
  }

  if (!(await isCodexAuthenticated(input.cookieValue))) {
    throw new BusinessRuleError(
      "CODEX_SESSION_EXPIRED",
      "Η τρέχουσα OpenAI σύνδεση δεν είναι πλέον έγκυρη. Σύνδεσέ την ξανά και δοκίμασε ξανά.",
      401,
    );
  }

  await writeAssistantProviderConfig({
    whatsAppAssistant: {
      provider: "codex",
      sessionId,
      configuredAt: new Date().toISOString(),
      configuredByUserId: input.configuredByUserId,
    },
  });

  return getWhatsAppAssistantProviderStatus();
}

export async function clearWhatsAppAssistantProvider() {
  await writeAssistantProviderConfig({});
  return getWhatsAppAssistantProviderStatus();
}
