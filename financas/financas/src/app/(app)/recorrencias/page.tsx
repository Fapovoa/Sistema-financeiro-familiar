"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { brl, brDate } from "@/lib/format";
import { Plus, Trash2, Pencil, X, Play, Pause } from "lucide-react";
import clsx from "clsx";

type Rule = {
  id: string; kind: "expense" | "income"; description: string; amount: number;
  category_id: string | null; account_id: string | null;
  day_of_month: number; start_date: string; end_date: string | null;
  months_ahead: number; active: boolean; notes: string | null;
  categories?: { name: string; color: string | null } | null;
  accounts?: { name: string } | null;
};

const EMPTY = {
  kind: "expense" as "expense" | "income",
  description: "", amount: "", category_id: "", account_id: "",
  day_of_month: "1", start_date: new Date().toISOString().slice(0, 10),
  end_date: "", months_ahead: "3", notes: "",
};

/**
 * Recorrências: contas fixas (receitas e despesas) com período de vigência.
 * As previsões futuras são geradas pelo servidor (status=previsto) e aparecem
 * no Fluxo de caixa. Inativar apaga as previsões futuras; reativar recria.
 * Com data de FIM preenchida, projeta até ela (o campo "Projetar" desabilita).
 */
export default function RecorrenciasPage() {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; type: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [{ data: r }, { data: c }, { data: a }] = await Promise.all([
      supabase.from("recurrences")
        .select("*, categories(name, color), accounts(name)")
        .order("active", { ascending: false })
        .order("day_of_month"),
      supabase.from("categories").select("id, name, type").order("name"),
      supabase.from("accounts").select("id, name").neq("type", "credit_card").order("name"),
    ]);
    setRules((r as Rule[]) ?? []); setCats(c ?? []); setAccounts(a ?? []);
  }
  useEffect(() => { load(); }, []);

  function startEdit(r: Rule) {
    setEditing(r.id);
    setForm({
      kind: r.kind, description: r.description,
      amount: String(r.amount).replace(".", ","),
      category_id: r.category_id ?? "", account_id: r.account_id ?? "",
      day_of_month: String(r.day_of_month), start_date: r.start_date,
      end_date: r.end_date ?? "", months_ahead: String(r.months_ahead), notes: r.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function payloadFromForm(extra: Partial<Rule> = {}) {
    return {
      id: editing ?? undefined,
      kind: form.kind,
      description: form.description,
      amount: parseFloat(form.amount.replace(/\./g, "").replace(",", ".")),
      category_id: form.category_id || null,
      account_id: form.account_id || null,
      day_of_month: parseInt(form.day_of_month, 10),
      start_date: form.start_date,
      end_date: form.end_date || null,
      months_ahead: parseInt(form.months_ahead, 10) || 3,
      active: true,
      notes: form.notes || null,
      ...extra,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/recurrences", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromForm(editing ? { active: rules.find((r) => r.id === editing)?.active ?? true } : {})),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: editing ? `Recorrência atualizada — ${json.forecasts} previsões futuras regeradas.` : `Recorrência criada — ${json.forecasts} previsões lançadas no caixa.` });
    setForm({ ...EMPTY }); setEditing(null); load();
  }

  async function toggleActive(r: Rule) {
    setBusy(r.id); setMsg(null);
    const res = await fetch("/api/recurrences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: r.id, kind: r.kind, description: r.description, amount: r.amount,
        category_id: r.category_id, account_id: r.account_id,
        day_of_month: r.day_of_month, start_date: r.start_date, end_date: r.end_date,
        months_ahead: r.months_ahead, active: !r.active, notes: r.notes,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: r.active ? "Recorrência inativada — previsões futuras removidas do caixa." : `Recorrência reativada — ${json.forecasts} previsões recriadas.` });
    load();
  }

  async function remove(r: Rule) {
    if (!confirm(`Excluir a recorrência "${r.description}"? As previsões futuras serão removidas; o que já foi pago/confirmado fica no histórico.`)) return;
    setBusy(r.id); setMsg(null);
    const res = await fetch("/api/recurrences", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao excluir: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: "Recorrência excluída." });
    load();
  }

  const receitas = rules.filter((r) => r.kind === "income");
  const despesas = rules.filter((r) => r.kind === "expense");
  const totalAtivasDespesa = despesas.filter((r) => r.active).reduce((s, r) => s + Number(r.amount), 0);
  const totalAtivasReceita = receitas.filter((r) => r.active).reduce((s, r) => s + Number(r.amount), 0);

  const temFim = !!form.end_date;

  return (
    <>
      <Header title="Recorrências" />
      <div className="space-y-5 p-6">
        {msg && (
          <p className={clsx("rounded-xl px-4 py-3 text-sm", msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
            {msg.text}
          </p>
        )}

        <form onSubmit={save} className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-3 xl:grid-cols-6">
          <label className="text-sm"><span className="mb-1 block font-medium">Tipo</span>
            <select className="input" value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as "expense" | "income", category_id: "" })}>
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select></label>
          <label className="text-sm xl:col-span-2"><span className="mb-1 block font-medium">Descrição</span>
            <input className="input" placeholder="Aluguel, salário, mensalidade…" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Valor (R$)</span>
            <input className="input" inputMode="decimal" placeholder="0,00" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Dia do mês</span>
            <input className="input" type="number" min={1} max={31} value={form.day_of_month}
              onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Categoria</span>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">—</option>
              {cats.filter((c) => c.type === form.kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Conta</span>
            <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Início</span>
            <input type="date" className="input" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} required /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Fim (opcional)</span>
            <input type="date" className="input" value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            <span className="text-[11px] text-ink-500">Em branco = sem data de fim</span></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Projetar (meses)</span>
            <input className={clsx("input", temFim && "opacity-50")} type="number" min={1} max={24}
              value={form.months_ahead} disabled={temFim}
              onChange={(e) => setForm({ ...form, months_ahead: e.target.value })} />
            <span className="text-[11px] text-ink-500">
              {temFim ? "Com fim definido, projeta até a data de fim" : "Sem fim: projeta N meses à frente"}
            </span></label>
          <div className="flex items-end gap-2 md:col-span-3 xl:col-span-3">
            <button className="btn-primary" disabled={saving}>
              <Plus size={16} /> {saving ? "Gravando…" : editing ? "Salvar alterações" : "Adicionar recorrência"}
            </button>
            {editing && (
              <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setForm({ ...EMPTY }); }}>
                <X size={15} /> Cancelar edição
              </button>
            )}
          </div>
        </form>

        <p className="text-sm text-ink-500">
          Ativas: <b className="text-success-fg">{brl(totalAtivasReceita)}</b> em receitas/mês ·{" "}
          <b className="text-danger-fg">{brl(totalAtivasDespesa)}</b> em despesas/mês.
          As previsões aparecem no Fluxo de caixa como “previsto” até a data projetada.
        </p>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {[{ titulo: "Despesas recorrentes", list: despesas, tone: "danger" }, { titulo: "Receitas recorrentes", list: receitas, tone: "success" }].map((col) => (
            <div key={col.titulo} className="card p-5">
              <h2 className="mb-3 font-bold">{col.titulo} <span className="text-sm font-normal text-ink-500">({col.list.length})</span></h2>
              <ul className="space-y-2">
                {col.list.map((r) => (
                  <li key={r.id} className={clsx("rounded-xl border px-4 py-3", r.active ? "border-slate-100" : "border-slate-100 bg-slate-50 opacity-70", editing === r.id && "ring-2 ring-brand-500")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-semibold">{r.description}</p>
                      <span className={clsx("font-bold", col.tone === "danger" ? "text-danger-fg" : "text-success-fg")}>{brl(Number(r.amount))}</span>
                      <span className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold", r.active ? "bg-success-bg text-success-fg" : "bg-slate-200 text-ink-500")}>
                        {r.active ? "ativa" : "inativa"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      todo dia {r.day_of_month} · desde {brDate(r.start_date)}
                      {r.end_date ? ` até ${brDate(r.end_date)}` : " · sem data de fim"}
                      {r.categories?.name && ` · ${r.categories.name}`}
                      {r.accounts?.name && ` · ${r.accounts.name}`}
                      {!r.end_date && ` · projeta ${r.months_ahead} meses`}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => toggleActive(r)} disabled={busy === r.id}
                        className="btn-ghost !px-3 !py-1 text-xs" title={r.active ? "Inativar (remove previsões futuras)" : "Reativar (recria previsões)"}>
                        {r.active ? <><Pause size={13} /> Inativar</> : <><Play size={13} /> Reativar</>}
                      </button>
                      <button onClick={() => startEdit(r)} disabled={busy === r.id} className="btn-ghost !px-3 !py-1 text-xs"><Pencil size={13} /> Editar</button>
                      <button onClick={() => remove(r)} disabled={busy === r.id}
                        className="btn-ghost !px-3 !py-1 text-xs text-danger-fg"><Trash2 size={13} /> Excluir</button>
                    </div>
                  </li>
                ))}
                {col.list.length === 0 && <p className="py-6 text-center text-sm text-ink-500">Nenhuma recorrência cadastrada.</p>}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-500">
          As recorrências criadas pelo checkbox “Recorrente” da página Receitas também aparecem nesta lista — as duas telas gravam no mesmo lugar.
        </p>
      </div>
    </>
  );
}
