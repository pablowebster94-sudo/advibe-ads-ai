import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Empty, PageHeader } from "@/components/ui";

export default async function AuditPage() {
  const s = await requireSession();
  const logs = await db.auditLog.findMany({ where: { orgId: s.orgId }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div>
      <PageHeader title="Auditoría" subtitle="Registro de operaciones sensibles: conexiones, publicaciones, cambios aprobados y configuración. No incluye secretos." />
      {logs.length === 0 ? <Empty>Sin registros todavía.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[640px]">
            <thead><tr><th className="th">Fecha</th><th className="th">Usuario</th><th className="th">Acción</th><th className="th">Objetivo</th><th className="th">Detalle</th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="td whitespace-nowrap text-zinc-400">{l.createdAt.toLocaleString("es")}</td>
                  <td className="td">{l.userEmail}</td>
                  <td className="td font-medium text-white">{l.action}</td>
                  <td className="td max-w-[140px] truncate text-zinc-400">{l.target}</td>
                  <td className="td max-w-xs truncate text-xs text-zinc-500">{l.detail ? JSON.stringify(l.detail) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
