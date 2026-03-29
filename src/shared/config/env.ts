function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const explicitLocalAuthSecret = readEnv("LOCAL_AUTH_SECRET");
const shouldUseDefaultLocalAuthSecret =
  process.env.NODE_ENV !== "production" && !readEnv("AUTH0_DOMAIN");

export const env = {
  databaseProvider:
    readEnv("DATABASE_PROVIDER") ??
    (readEnv("DATABASE_DIR") ? "pglite" : "postgresql"),
  databaseUrl: readEnv("DATABASE_URL"),
  databaseDir: readEnv("DATABASE_DIR") ?? ".data/pglite",
  databaseName: readEnv("DATABASE_NAME") ?? "template1",
  localAuthSecret:
    explicitLocalAuthSecret ??
    (shouldUseDefaultLocalAuthSecret ? "company-assistant-local-secret" : undefined),
  bootstrapAdminEmail:
    readEnv("BOOTSTRAP_ADMIN_EMAIL") ?? "admin@companyassistant.local",
  bootstrapAdminPassword:
    readEnv("BOOTSTRAP_ADMIN_PASSWORD") ?? "ChangeMe123!",
  bootstrapAdminName: readEnv("BOOTSTRAP_ADMIN_NAME") ?? "System Admin",
  auth0Domain: readEnv("AUTH0_DOMAIN"),
  auth0ClientId: readEnv("AUTH0_CLIENT_ID"),
  auth0ClientSecret: readEnv("AUTH0_CLIENT_SECRET"),
  auth0Secret: readEnv("AUTH0_SECRET"),
  auth0RoleClaim: readEnv("AUTH0_ROLE_CLAIM") ?? "https://companyassistant.app/role",
  appBaseUrl: readEnv("APP_BASE_URL"),
  companyTimeZone: readEnv("COMPANY_TIME_ZONE") ?? "Europe/Athens",
  externalTimeSources:
    readEnv("EXTERNAL_TIME_SOURCES") ??
    "https://www.cloudflare.com/cdn-cgi/trace,https://www.google.com/generate_204,https://www.apple.com",
  externalTimeCacheMs: Number(readEnv("EXTERNAL_TIME_CACHE_MS") ?? "300000"),
  externalTimeTimeoutMs: Number(readEnv("EXTERNAL_TIME_TIMEOUT_MS") ?? "3500"),
  externalTimeMaxDriftMs: Number(readEnv("EXTERNAL_TIME_MAX_DRIFT_MS") ?? "15000"),
  defaultAppointmentDurationMinutes: Number(
    readEnv("DEFAULT_APPOINTMENT_DURATION_MINUTES") ?? "60",
  ),
  openAiApiKey: readEnv("OPENAI_API_KEY"),
  openAiAssistantModel: readEnv("OPENAI_ASSISTANT_MODEL") ?? "gpt-5",
  whatsappVerifyToken: readEnv("WHATSAPP_VERIFY_TOKEN"),
  whatsappPhoneNumberId: readEnv("WHATSAPP_PHONE_NUMBER_ID"),
  whatsappDisplayPhoneNumber: readEnv("WHATSAPP_DISPLAY_PHONE_NUMBER"),
  whatsappAccessToken: readEnv("WHATSAPP_ACCESS_TOKEN"),
  whatsappAppSecret: readEnv("WHATSAPP_APP_SECRET"),
  whatsappGraphVersion: readEnv("WHATSAPP_GRAPH_VERSION") ?? "v25.0",
  whatsappPairingCodeTtlMinutes: Number(readEnv("WHATSAPP_PAIRING_CODE_TTL_MINUTES") ?? "15"),
  personalChannelsDir:
    readEnv("PERSONAL_CHANNELS_DIR") ?? ".data/personal-channels",
  imessageDbPath: readEnv("IMESSAGE_DB_PATH") ?? `${process.env.HOME ?? ""}/Library/Messages/chat.db`,
  imessagePollIntervalMs: Number(readEnv("IMESSAGE_POLL_INTERVAL_MS") ?? "4000"),
  imessageAssistantPrefix: readEnv("IMESSAGE_ASSISTANT_PREFIX") ?? "[Assistant] ",
  codexAuthFile: readEnv("CODEX_AUTH_FILE"),
  codexBaseUrl:
    readEnv("CODEX_BASE_URL") ??
    "https://chatgpt.com/backend-api/codex",
  codexOAuthClientId:
    readEnv("CODEX_OAUTH_CLIENT_ID") ?? "app_EMoamEEZ73f0CkXaXp7hrann",
  codexModel: readEnv("CODEX_MODEL") ?? "gpt-5.4",
};

export const isDatabaseConfigured =
  env.databaseProvider === "pglite"
    ? Boolean(env.databaseDir)
    : Boolean(env.databaseUrl);
export const isAuth0Configured = Boolean(
  env.auth0Domain &&
    env.auth0ClientId &&
    env.auth0ClientSecret &&
    env.auth0Secret,
);
export const isLocalAuthConfigured = Boolean(env.localAuthSecret);
export const authMode = isAuth0Configured
  ? isLocalAuthConfigured
    ? "hybrid"
    : "auth0"
  : isLocalAuthConfigured
    ? "local"
    : "disabled";
