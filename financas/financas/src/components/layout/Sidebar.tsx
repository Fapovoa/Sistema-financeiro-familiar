"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  LayoutGrid, ArrowLeftRight, CreditCard, Upload, TrendingUp,
  Wallet, CalendarRange, ShieldAlert, Landmark, Tags, Repeat, Target, User,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/importar", label: "Importar PDFs", icon: Upload },
  { href: "/despesas", label: "Despesas", icon: ArrowLeftRight },
  { href: "/cartoes", label: "Cartões", icon: CreditCard },
  { href: "/receitas", label: "Receitas", icon: TrendingUp },
  { href: "/recorrencias", label: "Recorrências", icon: Repeat },
  { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: CalendarRange },
  { href: "/orcamento", label: "Orçamento", icon: Target },
  { href: "/auditoria", label: "Auditoria", icon: ShieldAlert },
  { href: "/contas", label: "Contas & cartões", icon: Landmark },
  { href: "/categorias", label: "Categorias", icon: Tags },
  { href: "/perfil", label: "Perfil", icon: User },
];

export function Sidebar({ auditCount = 0 }: { auditCount?: number }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-100 bg-white px-4 py-5 lg:flex">
      <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white"><Wallet size={18} /></span>
        <span className="text-lg font-bold tracking-tight">Finanças</span>
      </Link>

      <nav className="flex-1 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href}
              className={clsx(
                "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active ? "bg-brand-50 text-brand-600" : "text-ink-700 hover:bg-slate-50"
              )}>
              <span className="flex items-center gap-3"><Icon size={17} /> {label}</span>
              {href === "/auditoria" && auditCount > 0 && (
                <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg">{auditCount}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-2xl bg-brand-500 p-4 text-white">
        <p className="text-sm font-semibold">Saúde financeira</p>
        <p className="mt-1 text-xs text-brand-100">Importe seus PDFs e deixe o sistema categorizar por você.</p>
        <Link href="/importar" className="mt-3 block rounded-full bg-white/15 px-3 py-1.5 text-center text-xs font-semibold hover:bg-white/25">
          Importar agora
        </Link>
      </div>
    </aside>
  );
}
