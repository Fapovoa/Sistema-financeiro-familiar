import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finanças Familiares",
  description: "Controle financeiro familiar com importação automática de extratos e faturas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
