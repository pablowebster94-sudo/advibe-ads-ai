# AdVibe Ads AI

Aplicación interna para la gestión de campañas de AdVibe Agencia.

## Estado del proyecto

Este repositorio se está inicializando con el código fuente base. Antes de usar datos reales o activar campañas, hay que configurar PostgreSQL y las variables de entorno, completar OAuth de Meta y cerrar los pendientes de seguridad e integración descritos en la documentación técnica.

## Fuente

El paquete inicial incluye Next.js, TypeScript, Prisma, autenticación de administrador, gestión básica de clientes y cuentas publicitarias, estrategia asistida por IA y un constructor de campañas que mantiene las campañas en pausa.

**No contiene credenciales ni tokens reales.**

## Build

El esquema Prisma fue normalizado en el commit `fd1e6c59555611e6144110b420ed652cdca54d45`. Este commit posterior solicita una nueva compilación automática desde `main` para validar el estado actualizado del proyecto.
