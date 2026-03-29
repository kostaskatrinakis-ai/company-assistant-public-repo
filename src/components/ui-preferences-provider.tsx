"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { UiLocale, UiTheme } from "@/shared/ui/types";
import { translate } from "@/shared/ui/types";

type UiPreferencesContextValue = {
  locale: UiLocale;
  theme: UiTheme;
  isPending: boolean;
  setLocale: (nextLocale: UiLocale) => void;
  setTheme: (nextTheme: UiTheme) => void;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

async function persistPreferences(input: {
  locale?: UiLocale;
  theme?: UiTheme;
}) {
  await fetch("/api/preferences", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export function UiPreferencesProvider({
  initialLocale,
  initialTheme,
  children,
}: {
  initialLocale: UiLocale;
  initialTheme: UiTheme;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [locale, setLocaleState] = useState<UiLocale>(initialLocale);
  const [theme, setThemeState] = useState<UiTheme>(initialTheme);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [locale, theme]);

  function setLocale(nextLocale: UiLocale) {
    if (nextLocale === locale) {
      return;
    }

    setLocaleState(nextLocale);
    startTransition(async () => {
      await persistPreferences({ locale: nextLocale, theme });
      router.refresh();
    });
  }

  function setTheme(nextTheme: UiTheme) {
    if (nextTheme === theme) {
      return;
    }

    setThemeState(nextTheme);
    startTransition(async () => {
      await persistPreferences({ locale, theme: nextTheme });
      router.refresh();
    });
  }

  const value = {
    locale,
    theme,
    isPending,
    setLocale,
    setTheme,
  };

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences() {
  const context = useContext(UiPreferencesContext);

  if (!context) {
    throw new Error("useUiPreferences must be used within UiPreferencesProvider.");
  }

  return context;
}

export function useTranslatedLabel(values: { el: string; en: string }) {
  const { locale } = useUiPreferences();
  return translate(locale, values);
}
