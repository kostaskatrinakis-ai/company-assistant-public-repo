"use client";

import { useUiPreferences } from "@/components/ui-preferences-provider";
import { translate } from "@/shared/ui/types";

export function UiPreferencesControls({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { locale, theme, setLocale, setTheme, isPending } = useUiPreferences();

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${
        compact
          ? ""
          : "glass-button rounded-[1.4rem] px-2.5 py-2 shadow-[0_16px_36px_rgba(62,82,162,0.14)]"
      }`}
    >
      <div className="inline-flex overflow-hidden rounded-full border border-slate-300/55 bg-white/70 shadow-[0_10px_24px_rgba(86,104,179,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
        {(["el", "en"] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={isPending}
            onClick={() => {
              setLocale(option);
            }}
            className={`px-3 py-1.5 text-xs font-medium transition ${
              locale === option
                ? "bg-white/88 text-slate-950 shadow-[0_10px_22px_rgba(61,78,157,0.16)] dark:bg-white/16 dark:text-slate-50"
                : "bg-transparent text-slate-800 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-white/10"
            }`}
          >
            {option.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="inline-flex overflow-hidden rounded-full border border-slate-300/55 bg-white/70 shadow-[0_10px_24px_rgba(86,104,179,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
        {(["light", "dark"] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={isPending}
            onClick={() => {
              setTheme(option);
            }}
            className={`px-3 py-1.5 text-xs font-medium capitalize transition ${
              theme === option
                ? "bg-white/88 text-slate-950 shadow-[0_10px_22px_rgba(61,78,157,0.16)] dark:bg-white/16 dark:text-slate-50"
                : "bg-transparent text-slate-800 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-white/10"
            }`}
          >
            {translate(locale, {
              el: option === "light" ? "Φωτεινό" : "Σκούρο",
              en: option === "light" ? "Light" : "Dark",
            })}
          </button>
        ))}
      </div>
    </div>
  );
}
