"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { brl, brDate } from "@/lib/format";
import { Pencil, Trash2, Check, X } from "lucide-react";
import clsx from "clsx";

type Row = {
  id: string;
  transaction_date: string;
  description_clean: string | null;
  amount: number;
  status: string;
  source: string;
  is_card_purchase: boolean;
  is_installment: boolean;
  installment_number: number | null;
  installment_total: number | null;
  category_id: string | null;
  categories?: { name: string; color: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  paid: "pago", forecast: "previsto", pending: "pendente", confirmed: "confirmado",
};

/**
 * Tabela de despesas com edição (client). A leitura é feita no server (página);
 * aqui só gravamos pelo servidor (/api/transactions/manual: PATCH e DELETE).
 * A edição NÃO altera affects_cash_flow / source (regra de caixa preservada).
 * Após gravar, router.refresh() recarrega os dados do server.
 */
export function DespesasTable({ rows, cats }: {
  rows: Row[];
  cats: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ date: "", description: "", amount: "", category_id: "", status: "paid" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function startEdit(r: Row) {
    setEditing(r.id);
    setEdit({
      date: r.transaction_date,
      description: r.description_clean ?? "",
      amount: String(Math.abs(Number(r.amount))).replace(".", ","),
      category_id: r.category_id ?? "",
      status: r.status,
    });
  }

  async function api(method: string, body: unknown) {
    const res = await fetch("/api/transactions/manual", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  }

  async function saveEdit(r: Row) {
    setBusy(r.id); setMsg(null);
    const { ok, json } = await api("PATCH", {
      id: r.id, kind: "expense",
      date: edit.date,
      description: edit.description,
      amount: parseFloat(edit.amount.replace(/\./g, "").replace(",", ".")),
      category_id: edit.category_id || null,
      status: edit.status,
    });
    setBusy(null);
    if (!ok) return setMsg({ ok: false, text: `ERRO ao salvar: ${json.error ?? ""}` });
    setEditing(null);
    setMsg({ ok: true, text: "Despesa atualizada." });
    router.refresh();
  }

  async function markPaid(r: Row) {
    setBusy(r.id); setMsg(null);
    const { ok, json } = await api("PATCH", { id: r.id, kind: "expense", status: "paid" });
    setBusy(null);
    if (!ok) return setMsg({ ok: false, text: `ERRO: ${json.error ?? ""}` });
    setMsg({ ok: true, text: "Marcada como paga." });
    router.refresh();
  }

  async function remove(r: Row) {
    if (!confirm(`Excluir "${r.description_clean ?? "esta despesa"}"? Esta ação não pode ser desfeita.`)) return;
    setBusy(r.id); setMsg(null);
    const { ok, json } = await api("DELETE", { id: r.id });
    setBusy(null);
    if (!ok) return setMsg({ ok: false, text: `ERRO ao excluir: ${json.error ?? ""}` });
    setMsg({ ok: true, text: "Despesa excluída." });
    router.refresh();
  }

  return (
    <>
      {msg && (
        <p className={clsx("rounded-xl px-4 py-3 text-sm", msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
          {msg.text}
        </p>
      )}
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-ink-500">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => {
              const isEditing = editing === t.id;
              const origem =
                t.source === "invoice_total" ? "Fatura de cartão" :
                t.is_card_purchase ? "Compra no cartão" :
                t.source === "manual" ? "Manual" : "Extrato";

              if (isEditing) {
                return (
                  <tr key={t.id} className="bg-brand-50/30">
                    <td className="px-4 py-2">
                      <input type="date" className="input py-1.5" value={edit.date}
                        onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                    </td>
                    <td className="px-4 py-2">
                      <input className="input py-1.5" value={edit.description}
                        onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                    </td>
                    <td className="px-4 py-2">
                      <select className="input py-1.5" value={edit.category_id}
                        onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                        <option value="">—</option>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-500">{origem}</td>
                    <td className="px-4 py-2">
                      <select className="input py-1.5" value={edit.status}
                        onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                        <option value="paid">Pago</option>
                        <option value="pending">Pendente</option>
                        <option value="forecast">Previsto</option>
                        <option value="confirmed">Confirmado</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input className="input py-1.5 text-right" inputMode="decimal" value={edit.amount}
                        onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => saveEdit(t)} disabled={busy === t.id}
                          className="rounded-lg p-1.5 text-success-fg hover:bg-success-bg" title="Salvar"><Check size={16} /></button>
                        <button onClick={() => setEditing(null)} disabled={busy === t.id}
                          className="rounded-lg p-1.5 text-ink-300 hover:bg-slate-100" title="Cancelar"><X size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-2.5">{brDate(t.transaction_date)}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{t.description_clean}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: t.categories?.color ?? "#CBD5E1" }} />
                      {t.categories?.name ?? "Não categorizado"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-500">
                    {origem}
                    {t.is_installment && ` · ${t.installment_number}/${t.installment_total}`}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold",
                      t.status === "paid" && "bg-success-bg text-success-fg",
                      t.status === "forecast" && "bg-brand-50 text-brand-600",
                      t.status === "pending" && "bg-warn-bg text-warn-fg",
                      t.status === "confirmed" && "bg-slate-100 text-ink-700")}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-danger-fg">{brl(t.amount)}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-1">
                      {t.status !== "paid" && (
                        <button onClick={() => markPaid(t)} disabled={busy === t.id}
                          className="rounded-lg p-1.5 text-success-fg hover:bg-success-bg" title="Marcar como paga"><Check size={15} /></button>
                      )}
                      <button onClick={() => startEdit(t)} disabled={busy === t.id}
                        className="rounded-lg p-1.5 text-ink-300 hover:bg-brand-50 hover:text-brand-600" title="Editar"><Pencil size={15} /></button>
                      <button onClick={() => remove(t)} disabled={busy === t.id}
                        className="rounded-lg p-1.5 text-ink-300 hover:bg-danger-bg hover:text-danger-fg" title="Excluir"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-500">Nenhuma despesa no período com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
