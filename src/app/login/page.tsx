import { redirect } from "next/navigation";
import { UiPreferencesControls } from "@/components/ui-preferences-controls";
import { getRoleHomePath } from "@/shared/auth/roles";
import { isAuth0Configured } from "@/shared/config/env";
import { getCurrentSessionUser } from "@/shared/auth/session";
import { getUiPreferences } from "@/shared/ui/server";
import type { UiLocale } from "@/shared/ui/types";
import { translate } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function getErrorMessage(locale: UiLocale, error?: string) {
  if (error === "invalid_credentials") {
    return translate(locale, {
      el: "Λάθος email ή κωδικός.",
      en: "Incorrect email or password.",
    });
  }

  if (error === "inactive_user") {
    return translate(locale, {
      el: "Ο λογαριασμός είναι ανενεργός.",
      en: "The account is inactive.",
    });
  }

  return null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const preferences = await getUiPreferences();
  const user = await getCurrentSessionUser();
  if (user) {
    redirect(getRoleHomePath(user.role));
  }

  const params = await searchParams;
  const errorMessage = getErrorMessage(preferences.locale, params.error);
  const authModeLabel = isAuth0Configured
    ? translate(preferences.locale, {
        el: "Εταιρική σύνδεση",
        en: "Single sign-on",
      })
    : translate(preferences.locale, {
        el: "Τοπικός λογαριασμός",
        en: "Local sign-in",
      });
  const authModeDescription = isAuth0Configured
    ? translate(preferences.locale, {
        el: "Η πρόσβαση γίνεται μέσω του εταιρικού παρόχου σύνδεσης και οι ρόλοι εφαρμόζονται αυτόματα μέσα στο πρόγραμμα.",
        en: "Access is handled through the configured identity provider and roles are applied automatically inside the app.",
      })
    : translate(preferences.locale, {
        el: "Η πρόσβαση γίνεται με προσωπικά στοιχεία σύνδεσης που έχουν αποθηκευτεί στο πρόγραμμα.",
        en: "Access uses personal sign-in details already stored in the app.",
      });

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="panel-strong w-full max-w-[1120px] overflow-hidden rounded-[2.6rem] border border-slate-200/55 shadow-[0_30px_90px_rgba(53,73,150,0.18)] dark:border-white/8">
        <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
          <section className="border-b border-slate-200/50 px-6 py-8 lg:border-b-0 lg:border-r lg:px-10 lg:py-12 dark:border-white/8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.34em] text-slate-800 dark:text-slate-300/75">
                company assistant
              </p>
              <UiPreferencesControls />
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-slate-950 dark:text-slate-50 md:text-5xl">
              {translate(preferences.locale, {
                el: "Ασφαλής είσοδος στο workspace.",
                en: "Secure access to the workspace.",
              })}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700 dark:text-slate-300/80">
              {translate(preferences.locale, {
                el: "Το app λειτουργεί πάνω σε πραγματική βάση δεδομένων, με προσωπικούς λογαριασμούς, ρόλους και καταγραφή ενεργειών.",
                en: "The app runs on a real database with personal accounts, roles, and action tracking.",
              })}
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.8rem] border border-slate-200/55 bg-white/58 p-4 shadow-[0_18px_46px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/8 dark:bg-white/6">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {translate(preferences.locale, {
                    el: "Τρόπος πρόσβασης",
                    en: "Access method",
                  })}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300/80">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{authModeLabel}</span>
                  <span className="block pt-2">{authModeDescription}</span>
                </p>
              </div>
              <div className="rounded-[1.8rem] border border-slate-200/55 bg-white/58 p-4 shadow-[0_18px_46px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/8 dark:bg-white/6">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {translate(preferences.locale, {
                    el: "Βασικές λειτουργίες",
                    en: "Core capabilities",
                  })}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300/80">
                  {translate(preferences.locale, {
                    el: "Υποστηρίζονται σύνδεση, πίνακες ανά ρόλο, πελάτες, βλάβες, ραντεβού, work orders, ώρες, υλικά, αναφορές και integrations με πραγματικά records.",
                    en: "The app supports sign-in, role-based dashboards, customers, incidents, appointments, work orders, time, materials, reporting, and integrations backed by real records.",
                  })}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-[1.8rem] border border-slate-200/55 bg-white/58 p-4 shadow-[0_18px_46px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/8 dark:bg-white/6">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {translate(preferences.locale, {
                  el: "Αρχική πρόσβαση",
                  en: "First access",
                })}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300/80">
                {translate(preferences.locale, {
                  el: "Αν η βάση είναι άδεια, δημιουργείται αυτόματα ο πρώτος admin για να στήσει τους υπόλοιπους λογαριασμούς.",
                  en: "If the database is empty, the first admin is created automatically and can then create the remaining accounts.",
                })}
              </p>
            </div>
          </section>

          <section className="bg-white/36 px-6 py-8 backdrop-blur-xl lg:px-10 lg:py-12 dark:bg-white/5">
            <div className="max-w-md">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-700 dark:text-slate-400">
                {translate(preferences.locale, {
                  el: "είσοδος",
                  en: "sign in",
                })}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
                {translate(preferences.locale, {
                  el: "Σύνδεση στο workspace",
                  en: "Sign in to the workspace",
                })}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300/80">
                {isAuth0Configured
                  ? translate(preferences.locale, {
                      el: "Η σύνδεση γίνεται μέσω του ενεργού παρόχου ταυτοποίησης.",
                      en: "Sign-in is handled by the active identity provider.",
                    })
                  : translate(preferences.locale, {
                      el: "Η σύνδεση γίνεται με email και κωδικό που υπάρχουν ήδη στη βάση.",
                      en: "Sign-in uses the email and password already stored in the database.",
                    })}
              </p>

              <form action="/api/auth/login" method="post" className="mt-8 space-y-4">
                <label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  {translate(preferences.locale, {
                    el: "Email",
                    en: "Email",
                  })}
                  <input
                    required
                    type="email"
                    name="email"
                    className="mt-2 w-full rounded-[1.5rem] border border-slate-200/60 bg-white/82 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)] dark:border-white/10 dark:bg-white/8 dark:text-slate-50"
                    placeholder={translate(preferences.locale, {
                      el: "name@company.gr",
                      en: "name@company.com",
                    })}
                  />
                </label>

                <label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  {translate(preferences.locale, {
                    el: "Κωδικός",
                    en: "Password",
                  })}
                  <input
                    required
                    type="password"
                    name="password"
                    className="mt-2 w-full rounded-[1.5rem] border border-slate-200/60 bg-white/82 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)] dark:border-white/10 dark:bg-white/8 dark:text-slate-50"
                    placeholder={translate(preferences.locale, {
                      el: "Εισαγωγή κωδικού",
                      en: "Enter password",
                    })}
                  />
                </label>

                {errorMessage ? (
                  <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {errorMessage}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="relative z-10 inline-flex w-full items-center justify-center rounded-full border border-blue-500/25 bg-[linear-gradient(135deg,#3049dd,#5b74ff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_20px_44px_rgba(58,82,210,0.28)] transition hover:brightness-[1.04] dark:border-white/10 dark:bg-white/14 dark:text-slate-50 dark:hover:bg-white/18"
                >
                  {translate(preferences.locale, {
                    el: "Είσοδος στο workspace",
                    en: "Enter workspace",
                  })}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
