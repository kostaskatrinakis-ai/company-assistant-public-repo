import { cookies } from "next/headers";
import {
  localeCookieName,
  normalizeLocale,
  normalizeTheme,
  themeCookieName,
} from "@/shared/ui/types";

export async function getUiPreferences() {
  const store = await cookies();

  return {
    locale: normalizeLocale(store.get(localeCookieName)?.value),
    theme: normalizeTheme(store.get(themeCookieName)?.value),
  };
}
