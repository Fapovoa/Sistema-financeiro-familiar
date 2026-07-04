
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus } from "lucide-react";

/** Despesa manual (Caju, dinheiro, débito avulso) — grava pelo servidor. */
export function ManualExpenseForm() {
  const supabase = createClient();
  const router = useRouter();
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; type: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "", amount: "", category_id: "", account_id: "",
    status: "paid", recurring: false,
  });

  useEffect(() => {
    supabase.from("categories").select("id, name").eq("type", "expense").order("name").then(({ data }) => setCats(data ?? []));
    supabase.from("accounts").select("id, name, type").neq("type", "credit_card").order("name").then(({ data }) => setAccounts(data ?? []));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/transactions/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "expense",
        date: form.date,
        description: form.description,
        amount: parseFloat(form.amount.replace(/\./g, "").replace(",", ".")),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        status: form.status,
        recurring: form.recurring,
        notes: null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: json.projected ? `Despesa gravada + ${json.projected} meses previstos.` : "Despesa gravada no banco." });
    setForm((f) => ({ ...f, description: "", amount: "" }));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card grid grid-cols-1 gap-3 p-4 md:grid-cols-3 xl:grid-cols-7">
      <label className="text-sm"><span className="mb-1 block font-medium">Data</span>
        <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
      <label className="text-sm xl:col-span-2"><span className="mb-1 block font-medium">Descrição</span>
        <input className="input" placeholder="Mercado no Caju, almoço…" value={form.description}
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
      <div className="flex items-end gap-3">
        <label className="flex items-center gap-2 pb-2.5 text-sm">
          <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
          Recorrente
        </label>
        <button className="btn-primary" disabled={saving}><Plus size={16} /> {saving ? "…" : "Lançar"}</button>
      </div>
      {msg && (
        <p className={`md:col-span-3 xl:col-span-7 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
