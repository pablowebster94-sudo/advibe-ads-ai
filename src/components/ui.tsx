import { cn } from "@/lib/format";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Pending({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <div className="font-semibold text-amber-300">Pendiente: {title}</div>
      <div className="mt-1 text-amber-100/80">{children}</div>
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: React.ReactNode }) {
  const c = kind === "error" ? "border-red-500/30 bg-red-500/5 text-red-200" : kind === "ok" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200" : "border-white/10 bg-white/5 text-zinc-300";
  return <div className={cn("rounded-xl border p-3 text-sm", c)}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-400">{children}</div>;
}

export function Stat({ label, value, delta, hint }: { label: string; value: string; delta?: number | null; hint?: string }) {
  return (
    <div className="card !p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {delta != null && isFinite(delta) && (
        <div className={cn("text-xs", delta >= 0 ? "text-emerald-400" : "text-red-400")}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs. período anterior
        </div>
      )}
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function StatusBadge({ s }: { s: string | null | undefined }) {
  const v = s || "—";
  const c = v === "ACTIVE" || v === "OK" || v === "EXECUTED" ? "bg-emerald-500/15 text-emerald-300" : v === "PAUSED" || v === "PENDING" || v === "DRAFT" || v === "PUBLISHED_PAUSED" ? "bg-amber-500/15 text-amber-300" : v === "ERROR" || v === "FAILED" || v === "EXPIRED" ? "bg-red-500/15 text-red-300" : "bg-white/10 text-zinc-300";
  return <span className={cn("badge", c)}>{v}</span>;
}
