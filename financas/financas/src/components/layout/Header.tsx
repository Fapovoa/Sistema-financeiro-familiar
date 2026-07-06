"use client";
import { Bell } from "lucide-react";

export function Header({ title }: { title: string; email?: string | null }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white/80 px-6 py-4 backdrop-blur">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <button className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-ink-700">
        <Bell size={17} />
      </button>
    </header>
  );
}
