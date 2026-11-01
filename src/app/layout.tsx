import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AdVibe Ads AI", description: "Centro de operaciones de Meta Ads de AdVibe Agencia" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
