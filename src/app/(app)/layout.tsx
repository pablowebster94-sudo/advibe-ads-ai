import Link from "next/link";
import { redirect } from "next/navigation";
import { destroySession, requireSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-white/5 bg-ink-900 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-5">
          <Link href="/dashboard" className="block">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-brand-400">AdVibe Agencia</div>
            <div className="text-lg font-bold text-white">Ads AI</div>
          </Link>
          <form action={logout} className="lg:hidden">
            <button className="btn-ghost !px-3 !py-1.5 text-xs">Salir</button>
          </form>
        </div>
        <Nav />
        <div className="hidden px-4 py-4 text-xs text-zinc-500 lg:absolute lg:bottom-0 lg:block lg:w-60">
          <div className="truncate">{s.email}</div>
          <form action={logout}>
            <button className="mt-1 text-zinc-400 underline hover:text-white">Cerrar sesión</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
