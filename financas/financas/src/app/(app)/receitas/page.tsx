"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { brl, brDate } from "@/lib/format";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import clsx from "clsx";
import {
  startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, format,
} from "date-fns";

const STATUS = [
  { v: "paid", label: "Recebida", cls: "bg-success-bg text-success-fg" },
  { v: "forecast", label: "Prevista", cls: "bg-brand-50 text-brand-600" },
  { v: "pending", label: "Atrasada", cls: "bg-danger-bg text-danger-fg" },
  { v: "ignored", label: "Cancelada", cls: "bg-slate-100 text-ink-500" },
];

// Períodos fixos + "Tudo" + Personalizado.
const PERIODS = [
  { key: "mes", label: "Mês atual" },
  { key: "mes-passado", label: "Mês passado" },
  { key: "3m", label: "Último trimestre" },
  { key: "6m", label: "Último semestre" },
  { key: "ano", label: "Ano atual" },
  { key: "tudo", label: "Tudo" },
  { key: "personalizado", label: "Personalizado" },
] as const;

function resolvePeriodo(periodo: string, de: string, ate: string): { startISO: string; endISO: string } | null {
  if (periodo === "tudo") return null;
  const hoje = new Date();
  let start: Date, end: Date;
  switch (periodo) {
    case "mes-passado": { const ref = subMonths(hoje, 1); start = startOfMonth(ref); end = endOfMonth(ref); break; }
    case "3m": start = startOfMonth(subMonths(hoje, 2)); end = endOfMonth(hoje); break;
    case "6m": start = startOfMonth(subMonths(hoje, 5)); end = endOfMonth(hoje); break;
    case "ano": start = startOfYear(hoje); end = endOfYear(hoje); break;
    case "personalizado": {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(de) ? new Date(de + "T12:00:00") : startOfMonth(hoje);
      const a = /^\d{4}-\d{2}-\d{2}$/.test(ate) ? new Date(ate + "T12:00:00") : endOfMonth(hoje);
      start = d <= a ? d : a; end = d <= a ? a : d; break;
    }
    default: start = startOfMonth(hoje); end = endOfMonth(hoje);
  }
  return { startISO: format(start, "yyyy-MM-dd"), endISO: format(end, "yyyy-MM-dd") };
}

/** Receitas: cadastro manual (à vista ou parcelado), edição e marcação de status. */
export default function ReceitasPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<any[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtro de período
  const [periodo, setPeriodo] = useState<string>("mes");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  // Edição de linha
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    date: "", description: "", amount: "", category_id: "", account_id: "", status: "paid",
  });

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "", amount: "", category_id: "", account_id: "",
    recurring: false, frequency: "monthly", status: "paid", notes: "",
    payType: "avista", installments: "2",
  });

  async function load(p = periodo, d = de, a = ate) {
    let tq = supabase.from("transactions")
      .select("id, transaction_date, description_clean, amount, status, category_id, account_id, is_recurring, is_installment, installment_number, installment_total, notes, categories(name, color), accounts(name)")
      .eq("type", "income")
      .order("transaction_date", { ascending: false })
      .limit(500);
    const range = resolvePeriodo(p, d, a);
    if (range) tq = tq.gte("transaction_date", range.startISO).lte("transaction_date", range.endISO);

    const [{ data: t }, { data: c }, { data: ac }] = await Promise.all([
      tq,
      supabase.from("categories").select("id, name").eq("type", "income").order("name"),
      supabase.from("accounts").select("id, name").order("name"),
    ]);
    setRows(t ?? []); setCats(c ?? []); setAccounts(ac ?? []);
  }
  useEffect(() => { load(); }, []);

  function onPeriodo(v: string) {
    setPeriodo(v);
    if (v !== "personalizado") load(v, de, ate);
  }

  const totalPeriodo = rows.reduce((s, r) => s + Number(r.amount), 0);

  // Prévia do parcelamento
  const valorNum = parseFloat((form.amount || "0").replace(/\./g, "").replace(",", ".")) || 0;
  const nParcelas = parseInt(form.installments, 10) || 0;
  const totalParcelado = valorNum * nParcelas;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const parcelado = form.payType === "parcelado";
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
        recurring: parcelado ? false : (form.recurring && form.frequency === "monthly"),
        notes: form.notes || null,
        installments: parcelado ? parseInt(form.installments, 10) || 2 : null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` });
    setMsg({
      ok: true,
      text: json.installments
        ? `Receita parcelada em ${json.installments}× — a 1ª registrada e ${json.installments - 1} previstas nos meses seguintes.`
        : json.projected ? `Receita gravada + ${json.projected} meses previstos.` : "Receita gravada no banco.",
    });
    setForm((f) => ({ ...f, description: "", amount: "", notes: "" }));
    load();
  }

  function startEdit(r: any) {
    setEditing(r.id);
    setEdit({
      date: r.transaction_date,
      description: r.description_clean ?? "",
      amount: String(Number(r.amount)).replace(".", ","),
      category_id: r.category_id ?? "",
      account_id: r.account_id ?? "",
      status: r.status,
    });
  }

  async function saveEdit(r: any) {
    setBusy(r.id); setMsg(null);
    const res = await fetch("/api/transactions/manual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: r.id, kind: "income",
        date: edit.date, description: edit.description,
        amount: parseFloat(edit.amount.replace(/\./g, "").replace(",", ".")),
        category_id: edit.category_id || null, account_id: edit.account_id || null,
        status: edit.status,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao salvar: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: "Lançamento atualizado." });
    setEditing(null);
    load();
  }

  async function markStatus(r: any, status: string) {
    setBusy(r.id); setMsg(null);
    const res = await fetch("/api/transactions/manual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, kind: "income", status }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: status === "paid" ? "Marcada como recebida." : "Status atualizado." });
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

  const parcelado = form.payType === "parcelado";

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
            <input className="input" placeholder="Salário, venda, aluguel recebido…" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Forma de recebimento</span>
            <select className="input" value={form.payType} onChange={(e) => setForm({ ...form, payType: e.target.value })}>
              <option value="avista">À vista</option>
              <option value="parcelado">Parcelado</option>
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Valor (R$)</span>
            <input className="input" inputMode="decimal" placeholder="0,00" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            {parcelado && <span className="text-[11px] text-ink-500">valor de cada parcela</span>}</label>
          {parcelado && (
            <label className="text-sm"><span className="mb-1 block font-medium">Nº de parcelas</span>
              <input className="input" type="number" min={2} max={60} value={form.installments}
                onChange={(e) => setForm({ ...form, installments: e.target.value })} /></label>
          )}
          <label className="text-sm"><span className="mb-1 block font-medium">Categoria</span>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Conta</span>
            <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Status {parcelado && "(1ª parcela)"}</span>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></label>
          <div className="flex items-end gap-3">
            <label className={clsx("flex items-center gap-2 pb-2.5 text-sm", parcelado && "opacity-40")}>
              <input type="checkbox" checked={parcelado ? false : form.recurring} disabled={parcelado}
                onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
              Recorrente (mensal)
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3 md:col-span-4 xl:col-span-8">
            <button className="btn-primary" disabled={saving}><Plus size={16} /> {saving ? "Salvando…" : "Adicionar receita"}</button>
            {parcelado ? (
              <p className="text-xs text-ink-500">
                {nParcelas || 0}× de <b>{brl(valorNum)}</b> = total <b>{brl(totalParcelado)}</b>.
                A 1ª cai na data escolhida; as demais entram como <b>previstas</b> nos meses seguintes.
              </p>
            ) : (
              <p className="text-xs text-ink-500">Receitas recorrentes são projetadas automaticamente para os próximos 3 meses como “previstas”.</p>
            )}
          </div>
        </form>

        {/* Filtro de período */}
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Período</span>
            <select className="input w-auto" value={periodo} onChange={(e) => onPeriodo(e.target.value)}>
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          {periodo === "personalizado" && (
            <>
              <label className="text-sm"><span className="mb-1 block font-medium">De</span>
                <input type="date" className="input w-auto" value={de} onChange={(e) => setDe(e.target.value)} /></label>
              <label className="text-sm"><span className="mb-1 block font-medium">Até</span>
                <input type="date" className="input w-auto" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
              <button type="button" className="btn-ghost" onClick={() => load("personalizado", de, ate)}>Aplicar</button>
            </>
          )}
          <p className="ml-auto text-sm text-ink-500">
            Total do período: <b className="text-success-fg">{brl(totalPeriodo)}</b> · {rows.length} receitas
          </p>
        </div>

        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-3">Data</th><th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const st = STATUS.find((s) => s.v === r.status);
                const isEditing = editing === r.id;

                if (isEditing) {
                  return (
                    <tr key={r.id} className="bg-brand-50/30">
                      <td className="px-4 py-2">
                        <input type="date" className="input py-1.5" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                      </td>
                      <td className="px-4 py-2">
                        <input className="input py-1.5" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                      </td>
                      <td className="px-4 py-2">
                        <select className="input py-1.5" value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                          <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select className="input py-1.5" value={edit.account_id} onChange={(e) => setEdit({ ...edit, account_id: e.target.value })}>
                          <option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select className="input py-1.5" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                          {STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input className="input py-1.5 text-right" inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => saveEdit(r)} disabled={busy === r.id}
                            className="rounded-lg p-1.5 text-success-fg hover:bg-success-bg" title="Salvar"><Check size={16} /></button>
                          <button onClick={() => setEditing(null)} disabled={busy === r.id}
                            className="rounded-lg p-1.5 text-ink-300 hover:bg-slate-100" title="Cancelar"><X size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-2.5">{brDate(r.transaction_date)}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {r.description_clean}
                      {r.is_recurring && <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">recorrente</span>}
                      {r.is_installment && <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-500">parcela {r.installment_number}/{r.installment_total}</span>}
                    </td>
                    <td className="px-4 py-2.5">{r.categories?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-500">{r.accounts?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold", st?.cls)}>{st?.label ?? r.status}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-success-fg">{brl(Number(r.amount))}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex justify-end gap-1">
                        {r.status !== "paid" && (
                          <button onClick={() => markStatus(r, "paid")} disabled={busy === r.id}
                            className="rounded-lg p-1.5 text-success-fg hover:bg-success-bg" title="Marcar como recebida"><Check size={15} /></button>
                        )}
                        <button onClick={() => startEdit(r)} disabled={busy === r.id}
                          className="rounded-lg p-1.5 text-ink-300 hover:bg-brand-50 hover:text-brand-600" title="Editar"><Pencil size={15} /></button>
                        <button onClick={() => remove(r.id)} disabled={busy === r.id}
                          className="rounded-lg p-1.5 text-ink-300 hover:bg-danger-bg hover:text-danger-fg" title="Excluir"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-500">Nenhuma receita no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
