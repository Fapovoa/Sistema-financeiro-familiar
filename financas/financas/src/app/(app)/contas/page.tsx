"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { FAMILY_USER_ID } from "@/lib/user";
import { brl } from "@/lib/format";
import { Landmark, CreditCard, PiggyBank, Wallet, TrendingUp, Plus, Trash2, Pencil, X } from "lucide-react";
import clsx from "clsx";

const TYPES = [
  { v: "checking", label: "Conta corrente", icon: Landmark },
  { v: "savings", label: "Poupança", icon: PiggyBank },
  { v: "credit_card", label: "Cartão de crédito", icon: CreditCard },
  { v: "cash", label: "Dinheiro", icon: Wallet },
  { v: "investment", label: "Investimento", icon: TrendingUp },
] as const;

type Account = {
  id: string; name: string; type: string; institution: string | null;
  last_four_digits: string | null; closing_day: number | null; due_day: number | null; credit_limit: number | null;
};

const EMPTY = { name: "", type: "checking", institution: "", last_four_digits: "", closing_day: "", due_day: "", credit_limit: "" };

export default function ContasPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Account[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("accounts").select("*").order("type").order("name");
    setRows((data as Account[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  function startEdit(a: Account) {
    setEditing(a.id);
    setForm({
      name: a.name, type: a.type, institution: a.institution ?? "",
      last_four_digits: a.last_four_digits ?? "",
      closing_day: a.closing_day?.toString() ?? "", due_day: a.due_day?.toString() ?? "",
      credit_limit: a.credit_limit?.toString() ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = {
      user_id: FAMILY_USER_ID,
      name: form.name.trim(),
      type: form.type,
      institution: form.institution.trim() || null,
      last_four_digits: form.last_four_digits.trim() || null,
      closing_day: form.type === "credit_card" && form.closing_day ? parseInt(form.closing_day) : null,
      due_day: form.type === "credit_card" && form.due_day ? parseInt(form.due_day) : null,
      credit_limit: form.type === "credit_card" && form.credit_limit ? parseFloat(form.credit_limit.replace(",", ".")) : null,
    };
    const { error } = editing
      ? await supabase.from("accounts").update(payload).eq("id", editing)
      : await supabase.from("accounts").insert(payload);
    if (error) return setMsg(error.message);
    setForm({ ...EMPTY }); setEditing(null); load();
  }

  async function remove(a: Account) {
    if (!confirm(`Excluir "${a.name}"? Os lançamentos já importados não são apagados, mas perdem o vínculo com esta conta.`)) return;
    const { error } = await supabase.from("accounts").delete().eq("id", a.id);
    if (error) setMsg(error.message);
    load();
  }

  const isCard = form.type === "credit_card";

  return (
    <>
      <Header title="Contas & cartões" />
      <div className="space-y-5 p-6">
        <form onSubmit={save} className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-3 xl:grid-cols-7">
          <label className="text-sm xl:col-span-2"><span className="mb-1 block font-medium">Nome</span>
            <input className="input" placeholder="Conta Itaú, Nubank…" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Tipo</span>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Instituição</span>
            <input className="input" placeholder="Itaú, Inter…" value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })} /></label>
          {isCard && (<>
            <label className="text-sm"><span className="mb-1 block font-medium">Final do cartão</span>
              <input className="input" placeholder="3754" maxLength={4} value={form.last_four_digits}
                onChange={(e) => setForm({ ...form, last_four_digits: e.target.value.replace(/\D/g, "") })} /></label>
            <label className="text-sm"><span className="mb-1 block font-medium">Dia de fechamento</span>
              <input className="input" type="number" min={1} max={31} value={form.closing_day}
                onChange={(e) => setForm({ ...form, closing_day: e.target.value })} /></label>
            <label className="text-sm"><span className="mb-1 block font-medium">Dia de vencimento</span>
              <input className="input" type="number" min={1} max={31} value={form.due_day}
                onChange={(e) => setForm({ ...form, due_day: e.target.value })} /></label>
            <label className="text-sm"><span className="mb-1 block font-medium">Limite (R$)</span>
              <input className="input" inputMode="decimal" placeholder="24199,00" value={form.credit_limit}
                onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></label>
          </>)}
          <div className="flex items-end gap-2 md:col-span-3 xl:col-span-7">
            <button className="btn-primary"><Plus size={16} /> {editing ? "Salvar alterações" : "Adicionar"}</button>
            {editing && (
              <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setForm({ ...EMPTY }); }}>
                <X size={15} /> Cancelar edição
              </button>
            )}
            {msg && <p className="text-sm text-danger-fg">{msg}</p>}
          </div>
        </form>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => {
            const T = TYPES.find((t) => t.v === a.type);
            const Icon = T?.icon ?? Landmark;
            return (
              <div key={a.id} className={clsx("card flex items-start gap-3 p-5", editing === a.id && "ring-2 ring-brand-500")}>
                <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white",
                  a.type === "credit_card" ? "bg-brand-500" : "bg-ink-700")}>
                  <Icon size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{a.name}</p>
                  <p className="text-xs text-ink-500">
                    {T?.label}{a.institution && ` · ${a.institution}`}{a.last_four_digits && ` · •••• ${a.last_four_digits}`}
                  </p>
                  {a.type === "credit_card" && (
                    <p className="mt-1 text-xs text-ink-500">
                      {a.closing_day && <>fecha dia {a.closing_day} · </>}
                      {a.due_day && <>vence dia {a.due_day} · </>}
                      {a.credit_limit && <>limite {brl(Number(a.credit_limit))}</>}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(a)} className="rounded-lg p-1.5 text-ink-300 hover:bg-brand-50 hover:text-brand-600"><Pencil size={15} /></button>
                  <button onClick={() => remove(a)} className="rounded-lg p-1.5 text-ink-300 hover:bg-danger-bg hover:text-danger-fg"><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <p className="col-span-full py-8 text-center text-sm text-ink-500">Nenhuma conta cadastrada ainda.</p>}
        </div>
      </div>
    </>
  );
}
