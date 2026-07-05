"use client";
import { Search, Bell, Plus } from "lucide-react";
import Link from "next/link";

export function Header({ title }: { title: string; email?: string | null }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white/80 px-6 py-4 backdrop-blur">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            className="w-64 rounded-full border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            placeholder="Buscar lançamento…"
          />
        </div>
        <Link href="/importar" className="btn-primary"><Plus size={16} /> Importar PDF</Link>
        <button className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-ink-700">
          <Bell size={17} />
        </button>
      </div>
    </header>
  );
}
