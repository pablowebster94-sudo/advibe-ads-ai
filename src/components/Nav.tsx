"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

const ITEMS = [
  ["/dashboard", "Dashboard"],
  ["/clients", "Clientes"],
  ["/connections", "Conexiones Meta"],
  ["/creative", "Creative Studio"],
  ["/strategy", "Estratega IA"],
  ["/campaigns", "Campañas"],
  ["/analytics", "Analítica"],
  ["/automations", "Automatizaciones"],
  ["/settings", "Configuración"],
  ["/audit", "Auditoría"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
      {ITEMS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
            path.startsWith(href) ? "bg-brand-500/15 font-semibold text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
