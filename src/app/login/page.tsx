import { redirect } from "next/navigation";
import { createSession, login } from "@/lib/auth";

async function doLogin(formData: FormData) {
  "use server";
  const s = await login(String(formData.get("email") || ""), String(formData.get("password") || ""));
  if (!s) redirect("/login?error=1");
  await createSession(s);
  redirect("/dashboard");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={doLogin} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-brand-400">AdVibe Agencia</div>
          <h1 className="text-2xl font-bold text-white">AdVibe Ads AI</h1>
          <p className="text-sm text-zinc-400">Centro de operaciones de Meta Ads</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-red-400">Credenciales incorrectas.</p>}
        <button className="btn w-full" type="submit">Entrar</button>
      </form>
    </main>
  );
}
