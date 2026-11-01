# AdVibe Ads AI

Centro de operaciones de Meta Ads para AdVibe Agencia (privado, con arquitectura multi‑organización lista para SaaS).
Next.js 15 · TypeScript · Prisma · PostgreSQL · Tailwind.

## Módulos
Dashboard · Clientes · Conexiones Meta · Creative Studio · Estratega IA · Campaign Builder · Analítica · Automatizaciones · Configuración · Auditoría.

## Reglas de seguridad de gasto (implementadas en código)
- Toda campaña, conjunto y anuncio se publica con `status: PAUSED`. No existe ninguna función de "activar".
- Las automatizaciones solo crean alertas o propuestas con simulación; ejecutar exige aprobación humana en pantalla.
- Publicar exige escribir `PUBLICAR EN PAUSA`. Las creatividades con escena de IA exigen verificación humana de que el producto es idéntico.
- Los activos (páginas, IG, pixel, públicos) se leen de la API de Meta; no se asumen.
- No hay datos de ejemplo: sin sincronización real, el dashboard muestra "pendiente".

## Variables de entorno
Ver `.env.example`. Obligatorias: `DATABASE_URL`, `SESSION_SECRET` (≥32), `ENCRYPTION_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_URL`.
Opcionales (también en Configuración, cifradas en BD): claves de Gemini/OpenAI/Anthropic, `META_APP_ID`/`META_APP_SECRET`.

## Puesta en marcha
```
npm install
cp .env.example .env   # completar
npm run db:push
npm run dev
```
El primer inicio de sesión con `ADMIN_EMAIL`/`ADMIN_PASSWORD` crea la organización y el usuario owner.

## Conectar Meta
- **OAuth:** crear app en developers.facebook.com (Marketing API), registrar `APP_URL/api/meta/callback`, cargar App ID/Secret. Para tus propias cuentas basta modo desarrollo.
- **Token de usuario del sistema:** Business Settings → Usuarios del sistema → token con `ads_management`, `ads_read`, `business_management`; pegarlo en Conexiones.

## Tarea diaria
`vercel.json` programa `/api/cron/sync` (requiere `CRON_SECRET`): sincroniza lectura y evalúa reglas (sin ejecutar).

## Estado de verificación
Ver el informe de entrega: la lógica de cifrado tiene pruebas (`npm test`); las rutas que escriben en Meta, OAuth y proveedores de IA requieren credenciales reales y no se han probado contra los servicios.
