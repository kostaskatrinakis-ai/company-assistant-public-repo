"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { translate } from "@/shared/ui/types";

type CustomerOption = {
  id: string;
  businessName: string;
  locations: Array<{
    id: string;
    name: string;
    address: string;
  }>;
};

type TechnicianOption = {
  id: string;
  fullName: string;
};

type LinkOption = {
  id: string;
  label: string;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type OperatorManualActionsProps = {
  customers: CustomerOption[];
  technicians: TechnicianOption[];
  requestOptions: LinkOption[];
  workOrderOptions: LinkOption[];
};

type FormKey = "customer" | "request" | "appointment" | "workOrder";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-line bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500 dark:bg-white/10 dark:text-slate-100 dark:focus:border-[var(--accent)]";
const labelClassName = "text-sm font-medium text-slate-700 dark:text-slate-300";

function emptyToNull(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoDateTime(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return new Date(value).toISOString();
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

function Feedback({ feedback }: { feedback?: FeedbackState }) {
  if (!feedback) {
    return null;
  }

  return (
    <p
      className={`mt-3 rounded-2xl px-3 py-2 text-sm ${
        feedback.tone === "success"
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200"
          : "bg-rose-50 text-rose-700 dark:bg-rose-500/12 dark:text-rose-200"
      }`}
    >
      {feedback.text}
    </p>
  );
}

function FormHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">{eyebrow}</p>
      <div>
        <h3 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

function DependencyNote({
  tone = "neutral",
  text,
}: {
  tone?: "neutral" | "warning";
  text: string;
}) {
  return (
    <p
      className={`mt-4 rounded-2xl px-3 py-2 text-sm leading-6 ${
        tone === "warning"
          ? "bg-amber-50 text-amber-900 dark:bg-amber-500/12 dark:text-amber-200"
          : "bg-slate-100 text-slate-600 dark:bg-slate-100 dark:text-slate-300"
      }`}
    >
      {text}
    </p>
  );
}

export function OperatorManualActions({
  customers,
  technicians,
  requestOptions,
  workOrderOptions,
}: OperatorManualActionsProps) {
  const router = useRouter();
  const { locale } = useUiPreferences();
  const [isPending, startTransition] = useTransition();
  const [busyForm, setBusyForm] = useState<FormKey | null>(null);
  const [requestCustomerId, setRequestCustomerId] = useState(customers[0]?.id ?? "");
  const [workOrderCustomerId, setWorkOrderCustomerId] = useState(customers[0]?.id ?? "");
  const [appointmentLinkType, setAppointmentLinkType] = useState<"request" | "workOrder">(
    "request",
  );
  const [feedbackByForm, setFeedbackByForm] = useState<
    Partial<Record<FormKey, FeedbackState>>
  >({});
  const hasCustomers = customers.length > 0;
  const hasTechnicians = technicians.length > 0;
  const hasRequests = requestOptions.length > 0;
  const hasWorkOrders = workOrderOptions.length > 0;
  const t = (values: { el: string; en: string }) => translate(locale, values);

  const requestLocations =
    customers.find((customer) => customer.id === requestCustomerId)?.locations ?? [];
  const workOrderLocations =
    customers.find((customer) => customer.id === workOrderCustomerId)?.locations ?? [];

  const appointmentDisabledReason = !hasTechnicians
    ? t({
        el: "Για νέο ραντεβού χρειάζεται τουλάχιστον ένας ενεργός τεχνικός.",
        en: "At least one active technician is required before creating an appointment.",
      })
    : appointmentLinkType === "request" && !hasRequests
      ? t({
          el: "Για ραντεβού πάνω σε request χρειάζεται τουλάχιστον ένα ανοιχτό request.",
          en: "A request-linked appointment needs at least one open request.",
        })
      : appointmentLinkType === "workOrder" && !hasWorkOrders
        ? t({
            el: "Για ραντεβού πάνω σε work order χρειάζεται τουλάχιστον ένα ενεργό work order.",
            en: "A work-order appointment needs at least one active work order.",
          })
        : null;
  const workOrderDisabledReason = !hasCustomers
    ? t({
        el: "Για νέο work order πρέπει πρώτα να υπάρχει πελάτης και εγκατάσταση.",
        en: "A customer and location must exist before creating a work order.",
      })
    : !hasTechnicians
      ? t({
          el: "Για ομαλή ανάθεση και εκτέλεση χρειάζεται τουλάχιστον ένας ενεργός τεχνικός.",
          en: "At least one active technician is required for assignment and execution.",
        })
      : null;

  function setFeedback(form: FormKey, feedback: FeedbackState) {
    setFeedbackByForm((current) => ({
      ...current,
      [form]: feedback,
    }));
  }

  async function handleCreateCustomer(formData: FormData, form: HTMLFormElement) {
    try {
      setBusyForm("customer");
      await submitJson("/api/customers", {
        businessName: String(formData.get("businessName") ?? ""),
        vatNumber: emptyToNull(formData.get("vatNumber")),
        mainPhone: emptyToNull(formData.get("mainPhone")),
        mainEmail: emptyToNull(formData.get("mainEmail")),
        notes: emptyToNull(formData.get("notes")),
      });

      form.reset();
      setFeedback("customer", {
        tone: "success",
        text: t({
          el: "Ο πελάτης αποθηκεύτηκε.",
          en: "Customer saved.",
        }),
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback("customer", {
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : t({
                el: "Αποτυχία δημιουργίας πελάτη.",
                en: "Customer creation failed.",
              }),
      });
    } finally {
      setBusyForm(null);
    }
  }

  async function handleCreateRequest(formData: FormData, form: HTMLFormElement) {
    try {
      setBusyForm("request");
      await submitJson("/api/requests", {
        customerId: emptyToNull(formData.get("customerId")),
        locationId: emptyToNull(formData.get("locationId")),
        sourceChannel: String(formData.get("sourceChannel") ?? "MANUAL"),
        description: String(formData.get("description") ?? ""),
        priority: String(formData.get("priority") ?? "TODAY"),
        reportedByName: emptyToNull(formData.get("reportedByName")),
      });

      form.reset();
      setRequestCustomerId(customers[0]?.id ?? "");
      setFeedback("request", {
        tone: "success",
        text: t({
          el: "Το αίτημα αποθηκεύτηκε.",
          en: "Request created.",
        }),
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback("request", {
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : t({
                el: "Αποτυχία δημιουργίας αιτήματος.",
                en: "Request creation failed.",
              }),
      });
    } finally {
      setBusyForm(null);
    }
  }

  async function handleCreateAppointment(formData: FormData, form: HTMLFormElement) {
    try {
      setBusyForm("appointment");
      await submitJson("/api/appointments", {
        requestId:
          appointmentLinkType === "request" ? emptyToNull(formData.get("requestId")) : null,
        workOrderId:
          appointmentLinkType === "workOrder"
            ? emptyToNull(formData.get("workOrderId"))
            : null,
        assignedUserId: String(formData.get("assignedUserId") ?? ""),
        startAt: toIsoDateTime(formData.get("startAt")),
        endAt: toIsoDateTime(formData.get("endAt")),
        reasonNote: emptyToNull(formData.get("reasonNote")),
      });

      form.reset();
      setAppointmentLinkType("request");
      setFeedback("appointment", {
        tone: "success",
        text: t({
          el: "Το ραντεβού αποθηκεύτηκε.",
          en: "Appointment saved.",
        }),
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback("appointment", {
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : t({
                el: "Αποτυχία δημιουργίας ραντεβού.",
                en: "Appointment creation failed.",
              }),
      });
    } finally {
      setBusyForm(null);
    }
  }

  async function handleCreateWorkOrder(formData: FormData, form: HTMLFormElement) {
    try {
      setBusyForm("workOrder");
      await submitJson("/api/work-orders", {
        requestId: emptyToNull(formData.get("requestId")),
        customerId: String(formData.get("customerId") ?? ""),
        locationId: String(formData.get("locationId") ?? ""),
        issueSummary: String(formData.get("issueSummary") ?? ""),
        assignedUserId: emptyToNull(formData.get("assignedUserId")),
      });

      form.reset();
      setWorkOrderCustomerId(customers[0]?.id ?? "");
      setFeedback("workOrder", {
        tone: "success",
        text: t({
          el: "Το work order δημιουργήθηκε.",
          en: "Work order created.",
        }),
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback("workOrder", {
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : t({
                el: "Αποτυχία δημιουργίας work order.",
                en: "Work order creation failed.",
              }),
      });
    } finally {
      setBusyForm(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="panel rounded-[2rem] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
          {t({ el: "χειροκίνητες ενέργειες", en: "manual actions" })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
          {t({
            el: "Χειροκίνητη καταχώριση στο σύστημα",
            en: "Manual entry into the system",
          })}
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {t({
            el: "Κάθε φόρμα γράφει κατευθείαν στην πραγματική βάση και στα ίδια API endpoints που χρησιμοποιούν οι υπόλοιπες ροές του προγράμματος.",
            en: "Each form writes directly to the real database through the same API endpoints used by the rest of the app.",
          })}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-[1.4rem] border border-line bg-white/70 px-4 py-3 text-sm text-slate-600">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {t({ el: "πελάτες", en: "customers" })}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{customers.length}</p>
          </div>
          <div className="rounded-[1.4rem] border border-line bg-white/70 px-4 py-3 text-sm text-slate-600">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {t({ el: "τεχνικοί", en: "technicians" })}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{technicians.length}</p>
          </div>
          <div className="rounded-[1.4rem] border border-line bg-white/70 px-4 py-3 text-sm text-slate-600">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {t({ el: "ανοιχτά αιτήματα", en: "open requests" })}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{requestOptions.length}</p>
          </div>
          <div className="rounded-[1.4rem] border border-line bg-white/70 px-4 py-3 text-sm text-slate-600">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {t({ el: "ενεργές εργασίες", en: "work orders" })}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{workOrderOptions.length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
      <form
        className="panel rounded-[2rem] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateCustomer(new FormData(event.currentTarget), event.currentTarget);
        }}
      >
        <FormHeader
          eyebrow={t({ el: "χειροκίνητη ενέργεια", en: "manual action" })}
          title={t({ el: "Νέος πελάτης", en: "New customer" })}
          description={t({
            el: "Ξεκίνα από εδώ όταν η εταιρεία δεν υπάρχει ακόμη στη βάση.",
            en: "Start here when the customer company does not exist in the database yet.",
          })}
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            {t({ el: "Επωνυμία", en: "Business name" })}
            <input required name="businessName" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            {t({ el: "ΑΦΜ", en: "VAT number" })}
            <input name="vatNumber" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            {t({ el: "Τηλέφωνο", en: "Phone" })}
            <input name="mainPhone" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            Email
            <input type="email" name="mainEmail" className={inputClassName} />
          </label>
        </div>
        <label className={`${labelClassName} mt-4 block`}>
          {t({ el: "Σημειώσεις", en: "Notes" })}
          <textarea name="notes" rows={3} className={inputClassName} />
        </label>
        <button
          type="submit"
          disabled={isPending && busyForm === "customer"}
          className="mt-4 inline-flex rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending && busyForm === "customer"
            ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
            : t({ el: "Αποθήκευση πελάτη", en: "Save customer" })}
        </button>
        <Feedback feedback={feedbackByForm.customer} />
      </form>

      <form
        className="panel rounded-[2rem] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateRequest(new FormData(event.currentTarget), event.currentTarget);
        }}
      >
        <FormHeader
          eyebrow={t({ el: "χειροκίνητη ενέργεια", en: "manual action" })}
          title={t({ el: "Νέο αίτημα", en: "New request" })}
          description={t({
            el: "Χρησιμοποίησέ το για νέα βλάβη ή νέο αίτημα. Αν λείπουν πελάτης ή εγκατάσταση, μένει σε αναμονή στοιχείων.",
            en: "Use it for a new incident or service request. If customer or location is missing, it stays awaiting details.",
          })}
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            {t({ el: "Πελάτης", en: "Customer" })}
            <select
              name="customerId"
              className={inputClassName}
              value={requestCustomerId}
              onChange={(event) => {
                setRequestCustomerId(event.target.value);
              }}
            >
              <option value="">{t({ el: "Χωρίς πελάτη", en: "No customer" })}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.businessName}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            {t({ el: "Εγκατάσταση", en: "Location" })}
            <select name="locationId" className={inputClassName}>
              <option value="">{t({ el: "Χωρίς εγκατάσταση", en: "No location" })}</option>
              {requestLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            {t({ el: "Κανάλι", en: "Channel" })}
            <select name="sourceChannel" className={inputClassName} defaultValue="MANUAL">
              <option value="MANUAL">MANUAL</option>
              <option value="APP">APP</option>
              <option value="WHATSAPP">WHATSAPP</option>
              <option value="PHONE">PHONE</option>
            </select>
          </label>
          <label className={labelClassName}>
            {t({ el: "Προτεραιότητα", en: "Priority" })}
            <select name="priority" className={inputClassName} defaultValue="TODAY">
              <option value="URGENT">URGENT</option>
              <option value="TODAY">TODAY</option>
              <option value="PLANNED">PLANNED</option>
            </select>
          </label>
        </div>
        <label className={`${labelClassName} mt-4 block`}>
          {t({ el: "Αναφέρθηκε από", en: "Reported by" })}
          <input name="reportedByName" className={inputClassName} />
        </label>
        <label className={`${labelClassName} mt-4 block`}>
          {t({ el: "Περιγραφή", en: "Description" })}
          <textarea required name="description" rows={4} className={inputClassName} />
        </label>
        <button
          type="submit"
          disabled={isPending && busyForm === "request"}
          className="mt-4 inline-flex rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending && busyForm === "request"
            ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
            : t({ el: "Αποθήκευση αιτήματος", en: "Save request" })}
        </button>
        <Feedback feedback={feedbackByForm.request} />
      </form>

      <form
        className="panel rounded-[2rem] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateAppointment(new FormData(event.currentTarget), event.currentTarget);
        }}
      >
        <FormHeader
          eyebrow={t({ el: "χειροκίνητη ενέργεια", en: "manual action" })}
          title={t({ el: "Νέο ραντεβού", en: "New appointment" })}
          description={t({
            el: "Κλείσε slot πάνω σε υπάρχον request ή work order. Η φόρμα ενεργοποιείται μόνο όταν υπάρχουν τα απαιτούμενα links.",
            en: "Book a slot against an existing request or work order. The form is enabled only when the required links exist.",
          })}
        />
        {appointmentDisabledReason ? (
          <DependencyNote tone="warning" text={appointmentDisabledReason} />
        ) : (
          <DependencyNote
            text={t({
              el: "Το ραντεβού γράφεται κατευθείαν στη βάση και εμφανίζεται στο ημερήσιο πρόγραμμα του τεχνικού.",
              en: "The appointment is stored directly in the database and appears in the technician's daily schedule.",
            })}
          />
        )}
        <fieldset disabled={Boolean(appointmentDisabledReason)} className="mt-4">
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            {t({ el: "Τύπος σύνδεσης", en: "Link type" })}
            <select
              className={inputClassName}
              value={appointmentLinkType}
              onChange={(event) => {
                setAppointmentLinkType(event.target.value as "request" | "workOrder");
              }}
            >
                <option value="request">{t({ el: "Αίτημα", en: "Request" })}</option>
                <option value="workOrder">{t({ el: "Work order", en: "Work order" })}</option>
              </select>
            </label>
          <label className={labelClassName}>
            {t({ el: "Τεχνικός", en: "Technician" })}
            <select required name="assignedUserId" className={inputClassName}>
              <option value="">{t({ el: "Επιλογή τεχνικού", en: "Select technician" })}</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.fullName}
                </option>
              ))}
            </select>
          </label>
          {appointmentLinkType === "request" ? (
            <label className={`${labelClassName} md:col-span-2`}>
              {t({ el: "Αίτημα", en: "Request" })}
              <select required name="requestId" className={inputClassName}>
                <option value="">{t({ el: "Επιλογή αιτήματος", en: "Select request" })}</option>
                {requestOptions.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={`${labelClassName} md:col-span-2`}>
              {t({ el: "Work order", en: "Work order" })}
              <select required name="workOrderId" className={inputClassName}>
                <option value="">{t({ el: "Επιλογή work order", en: "Select work order" })}</option>
                {workOrderOptions.map((workOrder) => (
                  <option key={workOrder.id} value={workOrder.id}>
                    {workOrder.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={labelClassName}>
            {t({ el: "Έναρξη", en: "Start" })}
            <input required type="datetime-local" name="startAt" className={inputClassName} />
          </label>
          <label className={labelClassName}>
            {t({ el: "Λήξη", en: "End" })}
            <input type="datetime-local" name="endAt" className={inputClassName} />
          </label>
        </div>
        <label className={`${labelClassName} mt-4 block`}>
          {t({ el: "Σημείωση", en: "Note" })}
          <textarea name="reasonNote" rows={3} className={inputClassName} />
        </label>
        <button
          type="submit"
          disabled={(isPending && busyForm === "appointment") || Boolean(appointmentDisabledReason)}
          className="mt-4 inline-flex rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending && busyForm === "appointment"
            ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
            : t({ el: "Αποθήκευση ραντεβού", en: "Save appointment" })}
        </button>
        </fieldset>
        <Feedback feedback={feedbackByForm.appointment} />
      </form>

      <form
        className="panel rounded-[2rem] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateWorkOrder(new FormData(event.currentTarget), event.currentTarget);
        }}
      >
        <FormHeader
          eyebrow={t({ el: "χειροκίνητη ενέργεια", en: "manual action" })}
          title={t({ el: "Νέο work order", en: "New work order" })}
          description={t({
            el: "Άνοιξε την ενεργή εργασία όταν έχεις πελάτη, εγκατάσταση και καθαρή περιγραφή προβλήματος.",
            en: "Open the active job when you have a customer, location, and a clear issue summary.",
          })}
        />
        {workOrderDisabledReason ? (
          <DependencyNote tone="warning" text={workOrderDisabledReason} />
        ) : (
          <DependencyNote
            text={t({
              el: "Αν βάλεις τεχνικό, το work order ξεκινά άμεσα ως προγραμματισμένο. Αλλιώς μένει draft για ανάθεση.",
              en: "If you assign a technician, the work order starts as scheduled. Otherwise it remains draft until assignment.",
            })}
          />
        )}
        <fieldset disabled={Boolean(workOrderDisabledReason)} className="mt-4">
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={`${labelClassName} md:col-span-2`}>
            {t({ el: "Συνδεδεμένο request", en: "Linked request" })}
            <select name="requestId" className={inputClassName}>
              <option value="">{t({ el: "Χωρίς συνδεδεμένο αίτημα", en: "No linked request" })}</option>
              {requestOptions.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            {t({ el: "Πελάτης", en: "Customer" })}
            <select
              required
              name="customerId"
              className={inputClassName}
              value={workOrderCustomerId}
              onChange={(event) => {
                setWorkOrderCustomerId(event.target.value);
              }}
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.businessName}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            {t({ el: "Εγκατάσταση", en: "Location" })}
            <select required name="locationId" className={inputClassName}>
              <option value="">{t({ el: "Επιλογή εγκατάστασης", en: "Select location" })}</option>
              {workOrderLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClassName} md:col-span-2`}>
            {t({ el: "Τεχνικός", en: "Technician" })}
            <select name="assignedUserId" className={inputClassName}>
              <option value="">{t({ el: "Χωρίς ανάθεση", en: "Unassigned" })}</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={`${labelClassName} mt-4 block`}>
          {t({ el: "Περιγραφή προβλήματος", en: "Issue summary" })}
          <textarea required name="issueSummary" rows={4} className={inputClassName} />
        </label>
        <button
          type="submit"
          disabled={(isPending && busyForm === "workOrder") || Boolean(workOrderDisabledReason)}
          className="mt-4 inline-flex rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending && busyForm === "workOrder"
            ? t({ el: "Αποθηκεύεται...", en: "Saving..." })
            : t({ el: "Αποθήκευση work order", en: "Save work order" })}
        </button>
        </fieldset>
        <Feedback feedback={feedbackByForm.workOrder} />
      </form>
    </div>
    </div>
  );
}
