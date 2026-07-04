"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { brl, brDate } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import clsx from "clsx";

const STATUS = [
  { v: "paid", label: "Recebida", cls: "bg-success-bg text-success-fg" },
  { v: "forecast", label: "Prevista", cls: "bg-brand-50 text-brand-600" },
  { v: "pending", label: "Atrasada", cls: "bg-danger-bg text-danger-fg" },
  { v: "ignored", label: "Cancelada", cls: "bg-slate-100 text-ink-500" },
];

/** Receitas: cadastro manual. Recorrentes são projetadas automaticamente (3 meses, status previsto). */
export default function ReceitasPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<any[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "", amount: "", category_id: "", account_id: "",
    recurring: false, frequency: "monthly", status: "paid", notes: "",
  });

  async function load() {
    const [{ data: t }, { data: c }, { data: a }] = await Promise.all([
      supabase.from("transactions")
        .select("id, transaction_date, description_clean, amount, status, is_recurring, notes, categories(name, color), accounts(name)")
        .eq("type", "income").order("transaction_date", { ascending: false }).limit(200),
      supabase.from("categories").select("id, name").eq("type", "income").order("name"),
      supabase.from("accounts").select("id, name").order("name"),
    ]);
    setRows(t ?? []); setCats(c ?? []); setAccounts(a ?? []);
  }
  useEffect(() => { load(); }, []);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/transactions/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "income",
        date: form.date,
        description: form.description,
        amount: parseFloat(form.amount.replace(/\./g, "").replace(",", ".")),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        status: form.status,
        recurring: form.recurring && form.frequency === "monthly",
        notes: form.notes || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: json.projected ? `Receita gravada + ${json.projected} meses previstos.` : "Receita gravada no banco." });
    setForm((f) => ({ ...f, description: "", amount: "", notes: "" }));
    load();
  }

  async function remove(id: string) {
    const res = await fetch("/api/transactions/manual", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg({ ok: false, text: `ERRO ao excluir: ${j.error ?? res.statusText}` }); return; }
    load();
  }

  return (
    <>
      <Header title="Receitas" />
      <div className="space-y-5 p-6">
        {msg && (
          <p className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{msg.text}</p>
        )}
        <form onSubmit={add} className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-4 xl:grid-cols-8">
          <label className="text-sm"><span className="mb-1 block font-medium">Data</span>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
          <label className="text-sm xl:col-span-2"><span className="mb-1 block font-medium">Descrição</span>
            <input className="input" placeholder="Salário, aluguel recebido…" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Valor (R$)</span>
            <input className="input" inputMode="decimal" placeholder="0,00" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Categoria</span>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Conta</span>
            <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Status</span>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></label>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2.5 text-sm">
              <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
              Recorrente (mensal)
            </label>
          </div>
          <div className="flex items-end md:col-span-4 xl:col-span-8">
            <button className="btn-primary" disabled={saving}><Plus size={16} /> {saving ? "Salvando…" : "Adicionar receita"}</button>
            <p className="ml-4 text-xs text-ink-500">Receitas recorrentes são projetadas automaticamente para os próximos 3 meses como “previstas”.</p>
          </div>
        </form>

        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-3">Data</th><th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Valor</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const st = STATUS.find((s) => s.v === r.status);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-2.5">{brDate(r.transaction_date)}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {r.description_clean}
                      {r.is_recurring && <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">recorrente</span>}
                    </td>
                    <td className="px-4 py-2.5">{r.categories?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-500">{r.accounts?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold", st?.cls)}>{st?.label ?? r.status}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-success-fg">{brl(Number(r.amount))}</td>
                    <td className="px-2">
                      <button onClick={() => remove(r.id)} className="rounded-lg p-1.5 text-ink-300 hover:bg-danger-bg hover:text-danger-fg"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-500">Nenhuma receita cadastrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
