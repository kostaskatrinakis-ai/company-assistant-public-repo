"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AssistantDrawer } from "@/components/assistant-drawer";
import { UiPreferencesControls } from "@/components/ui-preferences-controls";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import type { AppRole, SessionUser } from "@/shared/auth/types";
import { translate } from "@/shared/ui/types";

type WorkspaceShellProps = {
  user: SessionUser;
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function getRoleLabel(role: AppRole, locale: "el" | "en") {
  switch (role) {
    case "admin":
      return translate(locale, { el: "Έλεγχος admin", en: "Admin control" });
    case "owner":
      return translate(locale, { el: "Αναφορές ιδιοκτήτη", en: "Owner reporting" });
    case "operator":
      return translate(locale, { el: "Κέντρο operator", en: "Operator desk" });
    case "technician":
      return translate(locale, { el: "Κινητό τεχνικού", en: "Technician mobile" });
    default:
      return role;
  }
}

function getMobileGridClass(count: number) {
  if (count <= 1) {
    return "grid-cols-1";
  }

  if (count === 2) {
    return "grid-cols-2";
  }

  return "grid-cols-3";
}

export function WorkspaceShell({ user, children }: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const { locale } = useUiPreferences();
  const navByRole: Record<AppRole, NavItem[]> = {
    admin: [
      {
        href: "/admin",
        label: translate(locale, { el: "Κεντρικός πίνακας", en: "Admin dashboard" }),
        shortLabel: "Admin",
      },
      {
        href: "/admin/users",
        label: translate(locale, { el: "Χρήστες", en: "Users" }),
        shortLabel: translate(locale, { el: "Χρήστες", en: "Users" }),
      },
      {
        href: "/owner",
        label: translate(locale, { el: "Προβολή ιδιοκτήτη", en: "Owner view" }),
        shortLabel: translate(locale, { el: "Owner", en: "Owner" }),
      },
      {
        href: "/operator",
        label: translate(locale, { el: "Προβολή operator", en: "Operator view" }),
        shortLabel: translate(locale, { el: "Operator", en: "Operator" }),
      },
      {
        href: "/technician",
        label: translate(locale, { el: "Προβολή τεχνικού", en: "Technician view" }),
        shortLabel: translate(locale, { el: "Tech", en: "Tech" }),
      },
    ],
    owner: [
      {
        href: "/owner",
        label: translate(locale, { el: "Πίνακας ιδιοκτήτη", en: "Owner dashboard" }),
        shortLabel: "Owner",
      },
    ],
    operator: [
      {
        href: "/operator",
        label: translate(locale, { el: "Πίνακας operator", en: "Operator dashboard" }),
        shortLabel: translate(locale, { el: "Operator", en: "Operator" }),
      },
    ],
    technician: [
      {
        href: "/technician",
        label: translate(locale, { el: "Πίνακας τεχνικού", en: "Technician dashboard" }),
        shortLabel: "Tech",
      },
    ],
  };
  const navItems = navByRole[user.role];
  const currentItem =
    navItems.find((item) => isActivePath(pathname, item.href)) ?? navItems[0];
  const sessionLabel = user.authSource === "auth0"
    ? translate(locale, { el: "Auth0 ενεργό", en: "Auth0 active" })
    : translate(locale, { el: "Τοπική σύνδεση ενεργή", en: "Local sign-in active" });
  const compactSessionLabel = user.authSource === "auth0"
    ? "Auth0"
    : translate(locale, { el: "Τοπικό", en: "Local" });

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[6%] top-8 h-48 w-48 rounded-full bg-white/40 blur-3xl dark:bg-blue-300/6" />
        <div className="absolute left-[20%] top-[18%] h-72 w-72 rounded-full bg-blue-200/35 blur-3xl dark:bg-indigo-400/10" />
        <div className="absolute right-[9%] top-[10%] h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl dark:bg-blue-500/10" />
        <div className="absolute bottom-[10%] right-[14%] h-64 w-64 rounded-full bg-white/16 blur-3xl dark:bg-white/5" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1760px] flex-col gap-4 px-3 py-3 lg:flex-row lg:gap-6 lg:px-6 lg:py-6">
        <aside className="hidden lg:block lg:w-[330px]">
          <div className="glass-button sticky top-6 flex h-[calc(100vh-3rem)] flex-col rounded-[2.55rem] px-7 py-8 text-slate-900 dark:text-slate-50">
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.34em] text-slate-800 dark:text-slate-200/75">
                  company assistant
                </p>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/40 bg-white/55 px-3 py-1 text-xs font-semibold text-slate-900 shadow-[0_10px_24px_rgba(74,96,184,0.12)] dark:border-white/10 dark:bg-white/10 dark:text-slate-50">
                      {getRoleLabel(user.role, locale)}
                    </span>
                    <span className="rounded-full border border-white/35 bg-white/22 px-3 py-1 text-xs text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                      {sessionLabel}
                    </span>
                  </div>
                  <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.06em] text-slate-950 dark:text-slate-50">
                      {user.fullName}
                    </h1>
                    <p className="mt-2 max-w-[18rem] text-sm leading-6 text-slate-700 dark:text-slate-300/80">
                      {translate(locale, {
                        el: "Προσωπικός χώρος εργασίας για αιτήματα, ραντεβού, εργασίες και αναφορές.",
                        en: "Personal workspace for requests, appointments, jobs, and reporting.",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[2.05rem] border border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.18))] p-5 shadow-[0_22px_50px_rgba(77,98,190,0.16)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(10,15,31,0.16))]">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-600 dark:text-slate-400">
                  {translate(locale, { el: "τρέχον workspace", en: "current workspace" })}
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
                  {currentItem.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300/75">
                  {translate(locale, {
                    el: "Ενιαία επιχειρησιακή εικόνα με δικαιώματα ανά ρόλο και πραγματικά records.",
                    en: "Unified operations view with role-based permissions and real records.",
                  })}
                </p>
              </div>
            </div>

            <nav className="mt-8 flex-1 space-y-2.5">
              {navItems.map((item) => {
                const active = isActivePath(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group flex items-center justify-between rounded-[1.45rem] border px-4 py-3.5 transition ${
                      active
                        ? "border-white/40 bg-white/58 text-slate-950 shadow-[0_16px_40px_rgba(74,96,184,0.18)] dark:border-white/10 dark:bg-white/10 dark:text-slate-50"
                        : "border-transparent bg-white/8 text-slate-800 hover:border-white/30 hover:bg-white/26 hover:text-slate-950 dark:bg-transparent dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/6 dark:hover:text-slate-50"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p
                        className={`mt-1 text-xs ${
                          active ? "text-slate-600 dark:text-slate-400" : "text-slate-600 dark:text-slate-500"
                        }`}
                      >
                        {item.href}
                      </p>
                    </div>
                    <span
                      className={`text-sm ${
                        active
                          ? "text-[var(--accent)] dark:text-slate-200"
                          : "text-slate-400 dark:text-slate-500 transition group-hover:text-slate-700 dark:group-hover:text-slate-300"
                      }`}
                    >
                      →
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="space-y-4 border-t border-white/18 pt-6 dark:border-white/8">
              <UiPreferencesControls />
              {user.authSource === "auth0" ? (
                <Link
                  href="/auth/logout"
                  className="glass-button inline-flex rounded-full px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-white/32 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  {translate(locale, { el: "Αποσύνδεση", en: "Sign out" })}
                </Link>
              ) : (
                <form action="/api/auth/logout" method="post">
                  <button
                    type="submit"
                    className="glass-button inline-flex rounded-full px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-white/32 dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    {translate(locale, { el: "Αποσύνδεση", en: "Sign out" })}
                  </button>
                </form>
              )}
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-500">
                  {translate(locale, { el: "βασικές πληροφορίες", en: "key information" })}
                </p>
                <p>
                  {translate(locale, {
                    el: "Κάθε αλλαγή καταγράφεται με τον συνδεδεμένο χρήστη.",
                    en: "Every change is recorded against the signed-in user.",
                  })}
                </p>
                <p>
                  {translate(locale, {
                    el: "Οι διαθέσιμες ενέργειες εξαρτώνται από τον ρόλο και τα δικαιώματα πρόσβασης.",
                    en: "Available actions depend on the user's role and access permissions.",
                  })}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col rounded-[2.6rem] border border-white/18 bg-white/6 shadow-[0_36px_90px_rgba(53,73,150,0.18)] backdrop-blur-[28px] dark:border-white/6 dark:bg-black/8">
          <header className="sticky top-0 z-30 border-b border-white/18 bg-white/12 px-4 py-4 backdrop-blur-2xl dark:border-white/6 dark:bg-black/10 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-800 dark:text-slate-300/70">
                  company assistant
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                  {currentItem.label}
                </h1>
              </div>
              <div className="text-right">
                <p className="rounded-full border border-white/35 bg-white/55 px-3 py-1 text-xs font-medium text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-slate-50">
                  {translate(locale, {
                    el: user.role.toUpperCase(),
                    en: user.role.toUpperCase(),
                  })}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {compactSessionLabel}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-400">
              {translate(locale, {
                el: `${user.fullName} • επιχειρησιακή προβολή ανά ρόλο`,
                en: `${user.fullName} • role-based operations view`,
              })}
            </p>
            <div className="mt-4">
              <UiPreferencesControls compact />
            </div>
          </header>

          <main className="flex-1 px-4 pb-28 pt-6 md:px-6 lg:px-10 lg:pb-10 lg:pt-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[1.9rem] border border-white/25 bg-white/24 px-4 py-3 text-sm text-slate-800 shadow-[0_18px_48px_rgba(75,96,184,0.14)] backdrop-blur-2xl dark:border-white/8 dark:bg-white/5 dark:text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/35 bg-white/58 px-3 py-1 font-medium text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-slate-50">
                  {currentItem.label}
                </span>
                <span className="rounded-full border border-white/28 bg-white/20 px-3 py-1 dark:border-white/8 dark:bg-white/5">
                  {sessionLabel}
                </span>
              </div>
              <UiPreferencesControls compact />
            </div>

            {children}
          </main>

          <nav className="fixed inset-x-3 bottom-3 z-40 rounded-[2rem] border border-white/25 bg-white/26 p-2 shadow-[0_24px_56px_rgba(53,73,150,0.18)] backdrop-blur-2xl dark:border-white/8 dark:bg-[rgba(10,15,31,0.52)] dark:shadow-[0_24px_56px_rgba(0,0,0,0.45)] lg:hidden">
            <div
              className={`grid gap-2 ${getMobileGridClass(navItems.length)}`}
            >
              {navItems.map((item) => {
                const active = isActivePath(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-[1.2rem] border px-3 py-2 text-center text-xs font-medium transition ${
                      active
                        ? "border-white/35 bg-white/75 text-slate-950 dark:border-white/10 dark:bg-white/12 dark:text-slate-50"
                        : "border-transparent text-slate-700 hover:border-white/30 hover:bg-white/35 dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/8"
                    }`}
                  >
                    {item.shortLabel}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
      <AssistantDrawer
        canExecuteActions={user.permissions.includes("assistant.execute_actions")}
        canConfigureWhatsAppProvider={user.role === "admin"}
      />
    </div>
  );
}
