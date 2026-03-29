type PilotScopeCardProps = {
  title?: string;
  implemented: string[];
  planned: string[];
  compact?: boolean;
};

function ScopeList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "live" | "later";
  items: string[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
            tone === "live"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {tone === "live" ? "live" : "planned"}
        </span>
        <p className="text-sm font-medium text-slate-900">{title}</p>
      </div>

      <ul className="space-y-2 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PilotScopeCard({
  title = "Pilot scope status",
  implemented,
  planned,
  compact = false,
}: PilotScopeCardProps) {
  return (
    <div className="panel rounded-[2rem] p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{title}</p>
      <div className={`mt-4 grid gap-5 ${compact ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
        <ScopeList title="Available now" tone="live" items={implemented} />
        <ScopeList title="Planned next" tone="later" items={planned} />
      </div>
    </div>
  );
}
