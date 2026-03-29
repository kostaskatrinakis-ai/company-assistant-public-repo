export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <div className="panel rounded-[2rem] p-8">
        <p className="text-xs uppercase tracking-[0.28em] text-rose-700">
          access denied
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950">
          Δεν έχεις δικαίωμα πρόσβασης σε αυτή την οθόνη.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          Το foundation του MVP εφαρμόζει role checks ανά route και ανά action.
          Ο assistant επίσης κληρονομεί τα ίδια permissions.
        </p>
      </div>
    </main>
  );
}
