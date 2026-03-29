import type { Metadata } from "next";
import { UiPreferencesProvider } from "@/components/ui-preferences-provider";
import { ensureHeartbeatServiceRunning } from "@/modules/heartbeat/service";
import { getUiPreferences } from "@/shared/ui/server";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company Assistant",
  description:
    "WhatsApp, mobile and web operations dashboard for refrigeration service teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootLayoutInner>{children}</RootLayoutInner>;
}

async function RootLayoutInner({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  void ensureHeartbeatServiceRunning();
  const preferences = await getUiPreferences();

  return (
    <html
      lang={preferences.locale}
      className={`${preferences.theme === "dark" ? "dark " : ""}h-full antialiased`}
      data-theme={preferences.theme}
    >
      <body className="min-h-full flex flex-col">
        <UiPreferencesProvider
          initialLocale={preferences.locale}
          initialTheme={preferences.theme}
        >
          {children}
        </UiPreferencesProvider>
      </body>
    </html>
  );
}
