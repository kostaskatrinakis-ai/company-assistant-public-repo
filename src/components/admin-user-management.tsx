"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import type { SessionUser } from "@/shared/auth/types";
import { translate } from "@/shared/ui/types";

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type AdminUserManagementProps = {
  users: SessionUser[];
};

type ErrorResponseBody = {
  error?: {
    message?: string;
  };
};

const inputClassName =
  "mt-2 w-full rounded-2xl border border-line bg-white dark:bg-zinc-900/50 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none transition focus:border-teal-500 dark:focus:border-amber-500";
const labelClassName = "text-sm font-medium text-slate-700 dark:text-slate-300";

async function submitJson<T>(url: string, payload: T) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "Action failed.";

    throw new Error(message);
  }

  return body;
}

export function AdminUserManagement({ users }: AdminUserManagementProps) {
  const router = useRouter();
  const { locale } = useUiPreferences();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackState | undefined>();
  const t = (values: { el: string; en: string }) => translate(locale, values);

  async function handleCreateUser(formData: FormData, form: HTMLFormElement) {
    try {
      await submitJson("/api/admin/users", {
        email: String(formData.get("email") ?? ""),
        fullName: String(formData.get("fullName") ?? ""),
        role: String(formData.get("role") ?? "technician"),
        password: String(formData.get("password") ?? ""),
        phoneNumber:
          typeof formData.get("phoneNumber") === "string" &&
          String(formData.get("phoneNumber")).trim().length > 0
            ? String(formData.get("phoneNumber"))
            : null,
      });

      form.reset();
      setFeedback({
        tone: "success",
        text: t({
          el: "Ο χρήστης δημιουργήθηκε στη βάση.",
          en: "User created in the database.",
        }),
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : t({
                el: "Αποτυχία δημιουργίας χρήστη.",
                en: "User creation failed.",
              }),
      });
    }
  }

  function handleDeleteUser(userId: string) {
    if (
      !window.confirm(
        t({
          el: "Είστε σίγουροι ότι θέλετε να αρχειοθετήσετε αυτόν τον χρήστη; Θα παραμείνει στη βάση για ιστορικό, αλλά θα απενεργοποιηθεί και θα κρυφτεί από τις ενεργές λίστες.",
          en: "Are you sure you want to archive this user? They will remain in the database for history, but will be deactivated and hidden from active lists.",
        })
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/users/${userId}`, {
          method: "DELETE",
        });
        const body = (await response.json()) as ErrorResponseBody;

        if (!response.ok) {
          throw new Error(
            body?.error?.message || t({ el: "Αποτυχία αρχειοθέτησης χρήστη.", en: "User archive failed." }),
          );
        }

        setFeedback({
          tone: "success",
          text: t({
            el: "Ο χρήστης αρχειοθετήθηκε επιτυχώς.",
            en: "User archived successfully.",
          }),
        });
        router.refresh();
      } catch (error: unknown) {
        setFeedback({
          tone: "error",
          text:
            error instanceof Error
              ? error.message
              : t({ el: "Αποτυχία αρχειοθέτησης χρήστη.", en: "User archive failed." }),
        });
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <form
        className="panel rounded-[2rem] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateUser(new FormData(event.currentTarget), event.currentTarget);
        }}
      >
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
          {t({ el: "λογαριασμοί χρηστών", en: "user accounts" })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
          {t({ el: "Νέος χρήστης", en: "New user" })}
        </h3>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            {t({ el: "Ονοματεπώνυμο", en: "Full name" })}
            <input required name="fullName" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            Email
            <input required type="email" name="email" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            {t({ el: "Ρόλος", en: "Role" })}
            <select name="role" defaultValue="technician" className={inputClassName}>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
              <option value="operator">operator</option>
              <option value="technician">technician</option>
            </select>
          </label>
          <label className={labelClassName}>
            {t({ el: "Τηλέφωνο", en: "Phone" })}
            <input name="phoneNumber" className={inputClassName} />
          </label>
        </div>

        <label className={`${labelClassName} mt-4 block`}>
          {t({ el: "Κωδικός", en: "Password" })}
          <input
            required
            minLength={8}
            type="password"
            name="password"
            className={inputClassName}
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="mt-4 inline-flex rounded-full bg-teal-600 dark:bg-amber-500 px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 disabled:opacity-60"
        >
          {t({ el: "Αποθήκευση χρήστη", en: "Save user" })}
        </button>

        {feedback ? (
          <p
            className={`mt-3 rounded-2xl px-3 py-2 text-sm ${
              feedback.tone === "success"
                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                : "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}
      </form>

      <div className="panel overflow-hidden rounded-[2rem]">
        <div className="border-b border-line px-5 py-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
            {t({ el: "τρέχοντες χρήστες", en: "current users" })}
          </p>
        </div>
        {users.length > 0 ? (
          users.map((user) => (
            <div
              key={user.id}
              className="grid gap-4 border-b border-line px-5 py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_140px_160px_auto]"
            >
              <div>
                <p className="text-lg font-medium text-slate-950 dark:text-slate-50">{user.fullName}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                <p className="font-medium text-slate-900 dark:text-slate-100">{user.role}</p>
                <p>{user.authSource}</p>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                <p>
                  {translate(locale, {
                    el: `${user.permissions.length} δικαιώματα`,
                    en: `${user.permissions.length} permissions`,
                  })}
                </p>
                <p>
                  {translate(locale, {
                    el: user.isActive ? "ενεργός" : "ανενεργός",
                    en: user.isActive ? "active" : "inactive",
                  })}
                </p>
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleDeleteUser(user.id)}
                  disabled={isPending}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-900/40 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-50"
                  aria-label={t({ el: "Αρχειοθέτηση χρήστη", en: "Archive user" })}
                >
                  {t({ el: "Αρχειοθέτηση", en: "Archive" })}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
            {t({
              el: "Δεν υπάρχουν ακόμη χρήστες στη βάση.",
              en: "There are no users in the database yet.",
            })}
          </div>
        )}
      </div>
    </div>
  );
}
