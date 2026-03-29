"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { translate } from "@/shared/ui/types";

type TechnicianWorkbenchProps = {
  workOrders: Array<{
    id: string;
    customerName: string;
    locationName: string;
    state: string;
    issueSummary: string;
    followUpReason?: string | null;
    slotLabel?: string | null;
  }>;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

const inputClassName =
  "mt-2 w-full rounded-2xl border border-line bg-white dark:bg-zinc-900/50 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none transition focus:border-teal-500 dark:focus:border-amber-500";
const labelClassName = "text-sm font-medium text-slate-700 dark:text-slate-300";

function canStart(state: string) {
  return state === "SCHEDULED" || state === "FOLLOW_UP_REQUIRED";
}

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

function formatStateLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function Feedback({ feedback }: { feedback?: FeedbackState }) {
  if (!feedback) {
    return null;
  }

  return (
    <p
      className={`rounded-2xl px-3 py-2 text-sm ${
        feedback.tone === "success"
          ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
          : "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400"
      }`}
    >
      {feedback.text}
    </p>
  );
}

export function TechnicianWorkbench({ workOrders }: TechnicianWorkbenchProps) {
  const router = useRouter();
  const { locale } = useUiPreferences();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedbackByWorkOrder, setFeedbackByWorkOrder] = useState<
    Record<string, FeedbackState | undefined>
  >({});
  const t = (values: { el: string; en: string }) => translate(locale, values);

  function setFeedback(workOrderId: string, feedback: FeedbackState) {
    setFeedbackByWorkOrder((current) => ({
      ...current,
      [workOrderId]: feedback,
    }));
  }

  async function runAction(
    workOrderId: string,
    actionKey: string,
    action: () => Promise<unknown>,
    successText: string,
    form?: HTMLFormElement,
  ) {
    try {
      setBusyKey(actionKey);
      await action();
      form?.reset();
      setFeedback(workOrderId, {
        tone: "success",
        text: successText,
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback(workOrderId, {
        tone: "error",
        text: error instanceof Error ? error.message : t({ el: "Η ενέργεια απέτυχε.", en: "Action failed." }),
      });
    } finally {
      setBusyKey(null);
    }
  }

  if (workOrders.length === 0) {
    return (
      <div className="panel rounded-[2rem] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
          {t({ el: "εργασίες τεχνικού", en: "technician workspace" })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
          {t({
            el: "Δεν υπάρχει ενεργή εργασία για καταχώριση",
            en: "There is no active job to update",
          })}
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {t({
            el: "Μόλις ανατεθεί ή προγραμματιστεί work order στο όνομά σου, εδώ θα εμφανιστούν οι ενέργειες για έναρξη, ώρες, υλικά και κλείσιμο.",
            en: "As soon as a work order is assigned or scheduled for you, the actions for start, time, materials, and closeout will appear here.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="panel rounded-[2rem] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
          {t({ el: "εκτέλεση εργασίας", en: "job execution" })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
          {t({ el: "Καταχώριση πάνω στη δουλειά", en: "Work order updates" })}
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {t({
            el: "Από εδώ κάνεις έναρξη, χρόνο, υλικά, ολοκλήρωση και follow-up για κάθε ανάθεση.",
            en: "Use this area to start work, log time, record materials, complete jobs, and mark follow-up visits.",
          })}
        </p>
      </div>

      {workOrders.map((workOrder) => {
        const startKey = `${workOrder.id}:start`;
        const timeKey = `${workOrder.id}:time`;
        const materialKey = `${workOrder.id}:material`;
        const completeKey = `${workOrder.id}:complete`;
        const followUpKey = `${workOrder.id}:follow-up`;

        return (
          <div key={workOrder.id} className="panel rounded-[2rem] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-teal-50 dark:bg-amber-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-amber-500">
                    {formatStateLabel(workOrder.state)}
                  </span>
                  <span className="rounded-full border border-line px-3 py-1 text-xs text-slate-500 dark:text-slate-400">
                    {workOrder.id}
                  </span>
                  {workOrder.slotLabel ? (
                    <span className="rounded-full border border-line px-3 py-1 text-xs text-slate-500 dark:text-slate-400">
                      {workOrder.slotLabel}
                    </span>
                  ) : null}
                </div>
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                    {workOrder.customerName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{workOrder.locationName}</p>
                </div>
                <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {workOrder.followUpReason ?? workOrder.issueSummary}
                </p>
              </div>

              {canStart(workOrder.state) ? (
                <button
                  type="button"
                  disabled={isPending && busyKey === startKey}
                  onClick={() => {
                    void runAction(
                      workOrder.id,
                      startKey,
                      () => submitJson(`/api/work-orders/${workOrder.id}/start`, {}),
                      t({
                        el: "Η εργασία πέρασε σε εξέλιξη.",
                        en: "The work order moved to in progress.",
                      }),
                    );
                  }}
                  className="inline-flex rounded-full bg-slate-950 dark:bg-amber-500 px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 transition hover:bg-slate-800 dark:hover:bg-amber-400 disabled:opacity-60"
                >
                  {isPending && busyKey === startKey
                    ? t({ el: "Γίνεται έναρξη...", en: "Starting..." })
                    : t({ el: "Έναρξη εργασίας", en: "Start work" })}
                </button>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <details className="details-reset rounded-[1.6rem] border border-line bg-white/70 dark:bg-zinc-800/50 p-4">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t({ el: "Καταχώριση χρόνου", en: "Time entry" })}
                </summary>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {t({
                    el: "Απαιτείται χρόνος εργασίας ή μετακίνησης για σωστή αναφορά.",
                    en: "Work and travel time are needed for proper reporting.",
                  })}
                </p>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);

                    void runAction(
                      workOrder.id,
                      timeKey,
                      () =>
                        submitJson(`/api/work-orders/${workOrder.id}/time-entries`, {
                          minutesWorked: Number(formData.get("minutesWorked") ?? 0),
                          minutesTravel: Number(formData.get("minutesTravel") ?? 0),
                          note:
                            typeof formData.get("note") === "string" &&
                            String(formData.get("note")).trim().length > 0
                              ? String(formData.get("note"))
                              : null,
                        }),
                      t({
                        el: "Η καταγραφή χρόνου αποθηκεύτηκε.",
                        en: "Time entry saved.",
                      }),
                      form,
                    );
                  }}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClassName}>
                      {t({ el: "Λεπτά εργασίας", en: "Work minutes" })}
                      <input
                        required
                        min={0}
                        type="number"
                        name="minutesWorked"
                        className={inputClassName}
                        defaultValue={45}
                      />
                    </label>
                    <label className={labelClassName}>
                      {t({ el: "Λεπτά μετακίνησης", en: "Travel minutes" })}
                      <input
                        min={0}
                        type="number"
                        name="minutesTravel"
                        className={inputClassName}
                        defaultValue={0}
                      />
                    </label>
                  </div>
                  <label className={`${labelClassName} block`}>
                    {t({ el: "Σημείωση", en: "Note" })}
                    <textarea name="note" rows={3} className={inputClassName} />
                  </label>
                  <button
                    type="submit"
                    disabled={isPending && busyKey === timeKey}
                    className="inline-flex rounded-full bg-teal-600 dark:bg-amber-500 px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 disabled:opacity-60"
                  >
                    {isPending && busyKey === timeKey
                      ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
                      : t({ el: "Αποθήκευση χρόνου", en: "Save time entry" })}
                  </button>
                </form>
              </details>

              <details className="details-reset rounded-[1.6rem] border border-line bg-white/70 dark:bg-zinc-800/50 p-4">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t({ el: "Καταχώριση υλικού", en: "Material entry" })}
                </summary>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {t({
                    el: "Πέρασε μόνο ό,τι χρησιμοποιήθηκε πράγματι στην εργασία.",
                    en: "Record only the material actually used on the job.",
                  })}
                </p>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);

                    void runAction(
                      workOrder.id,
                      materialKey,
                      () =>
                        submitJson(`/api/work-orders/${workOrder.id}/materials`, {
                          description: String(formData.get("description") ?? ""),
                          quantity: Number(formData.get("quantity") ?? 0),
                          unit: String(formData.get("unit") ?? ""),
                          estimatedCost:
                            typeof formData.get("estimatedCost") === "string" &&
                            String(formData.get("estimatedCost")).trim().length > 0
                              ? Number(formData.get("estimatedCost"))
                              : null,
                        }),
                      t({
                        el: "Το υλικό αποθηκεύτηκε.",
                        en: "Material saved.",
                      }),
                      form,
                    );
                  }}
                >
                  <label className={`${labelClassName} block`}>
                    {t({ el: "Περιγραφή", en: "Description" })}
                    <input required name="description" className={inputClassName} />
                  </label>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className={labelClassName}>
                      {t({ el: "Ποσότητα", en: "Quantity" })}
                      <input
                        required
                        min={0.01}
                        step="0.01"
                        type="number"
                        name="quantity"
                        className={inputClassName}
                        defaultValue={1}
                      />
                    </label>
                    <label className={labelClassName}>
                      {t({ el: "Μονάδα", en: "Unit" })}
                        <input
                          required
                          name="unit"
                          className={inputClassName}
                          defaultValue={t({ el: "τεμ", en: "pcs" })}
                        />
                    </label>
                    <label className={labelClassName}>
                      {t({ el: "Εκτίμηση κόστους", en: "Estimated cost" })}
                      <input min={0} step="0.01" type="number" name="estimatedCost" className={inputClassName} />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={isPending && busyKey === materialKey}
                    className="inline-flex rounded-full bg-teal-600 dark:bg-amber-500 px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 disabled:opacity-60"
                  >
                    {isPending && busyKey === materialKey
                      ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
                      : t({ el: "Αποθήκευση υλικού", en: "Save material" })}
                  </button>
                </form>
              </details>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <form
                className="rounded-[1.6rem] border border-line bg-white/70 dark:bg-zinc-800/50 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const formData = new FormData(form);

                  void runAction(
                    workOrder.id,
                    completeKey,
                    () =>
                      submitJson(`/api/work-orders/${workOrder.id}/complete`, {
                        resolutionSummary: String(formData.get("resolutionSummary") ?? ""),
                      }),
                    t({
                      el: "Η εργασία ολοκληρώθηκε.",
                      en: "Work order completed.",
                    }),
                    form,
                  );
                }}
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t({ el: "Κλείσιμο εργασίας", en: "Close work order" })}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {t({
                    el: "Χρειάζεται καθαρή περιγραφή αποτελέσματος πριν περάσει σε completed.",
                    en: "A clear resolution summary is required before the work order can be completed.",
                  })}
                </p>
                <label className={`${labelClassName} mt-4 block`}>
                  {t({ el: "Σύνοψη αποτελέσματος", en: "Resolution summary" })}
                  <textarea
                    required
                    minLength={5}
                    name="resolutionSummary"
                    rows={4}
                    className={inputClassName}
                  />
                </label>
                <button
                  type="submit"
                  disabled={isPending && busyKey === completeKey}
                  className="mt-4 inline-flex rounded-full bg-slate-950 dark:bg-amber-500 px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 transition hover:bg-slate-800 dark:hover:bg-amber-400 disabled:opacity-60"
                >
                  {isPending && busyKey === completeKey
                    ? t({ el: "Ολοκληρώνεται...", en: "Completing..." })
                    : t({ el: "Ολοκλήρωση", en: "Complete" })}
                </button>
              </form>

              <form
                className="rounded-[1.6rem] border border-line bg-white/70 dark:bg-zinc-800/50 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const formData = new FormData(form);

                  void runAction(
                    workOrder.id,
                    followUpKey,
                    () =>
                      submitJson(`/api/work-orders/${workOrder.id}/follow-up`, {
                        followUpReason: String(formData.get("followUpReason") ?? ""),
                        resolutionSummary:
                          typeof formData.get("resolutionSummary") === "string" &&
                          String(formData.get("resolutionSummary")).trim().length > 0
                            ? String(formData.get("resolutionSummary"))
                            : null,
                      }),
                    t({
                      el: "Η εργασία πέρασε σε follow-up.",
                      en: "The work order was moved to follow-up.",
                    }),
                    form,
                  );
                }}
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t({ el: "Σήμανση follow-up", en: "Mark follow-up" })}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {t({
                    el: "Χρησιμοποίησέ το μόνο όταν απαιτείται νέα επίσκεψη ή νέο slot.",
                    en: "Use this only when a new visit or a new slot is required.",
                  })}
                </p>
                <label className={`${labelClassName} mt-4 block`}>
                  {t({ el: "Λόγος follow-up", en: "Follow-up reason" })}
                  <textarea
                    required
                    minLength={5}
                    name="followUpReason"
                    rows={3}
                    className={inputClassName}
                  />
                </label>
                <label className={`${labelClassName} mt-4 block`}>
                  {t({ el: "Σύντομη σημείωση αποτελέσματος", en: "Short resolution note" })}
                  <textarea name="resolutionSummary" rows={3} className={inputClassName} />
                </label>
                <button
                  type="submit"
                  disabled={isPending && busyKey === followUpKey}
                  className="mt-4 inline-flex rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-amber-400 disabled:opacity-60"
                >
                  {isPending && busyKey === followUpKey
                    ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
                    : t({ el: "Χρειάζεται follow-up", en: "Needs follow-up" })}
                </button>
              </form>
            </div>

            <div className="mt-4">
              <Feedback feedback={feedbackByWorkOrder[workOrder.id]} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
