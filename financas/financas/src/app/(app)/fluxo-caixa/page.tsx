"use client";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { brl, brDate } from "@/lib/format";
import clsx from "clsx";
import { addDays, endOfMonth, endOfYear, format, startOfMonth, startOfYear } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const PERIODS = [
  { key: "mes", label: "Mês atual" },
  { key: "30", label: "Próximos 30 dias" },
  { key: "60", label: "Próximos 60 dias" },
  { key: "90", label: "Próximos 90 dias" },
  { key: "ano", label: "Ano completo" },
] as const;

type Tx = {
  transaction_date: string;
  amount: number;
  type: string;
  status: string;
  source: string;
  description_clean: string | null;
};

// Realizado = já aconteceu de fato; Previsto = ainda vai acontecer (previsto/pendente).
const isRealizado = (s: string) => s === "paid" || s === "confirmed";
const isPrevisto = (s: string) => s === "forecast" || s === "pending";

// Cores: recebido (verde escuro/claro) e pago (azul escuro/claro)
const COLORS = {
  recebReal: "#16A34A",
  recebPrev: "#86EFAC",
  pagReal: "#4A6CF7",
  pagPrev: "#C7D2FE",
};

const NOMES: Record<string, string> = {
  recebReal: "Recebido (realizado)",
  recebPrev: "A receber (previsto)",
  pagReal: "Pago (realizado)",
  pagPrev: "A pagar (previsto)",
};

function Etiqueta({ previsto }: { previsto: boolean }) {
  return (
    <span className={clsx("rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
      previsto ? "bg-brand-50 text-brand-600" : "bg-success-bg text-success-fg")}>
      {previsto ? "previsto" : "realizado"}
    </span>
  );
}

/**
 * Fluxo de caixa diário, interativo:
 * - Barras por data: a receber (verde) × a pagar (azul); tom claro = previsto, tom escuro = realizado.
 * - Clique numa barra ou numa linha da tabela para ver o detalhamento do dia.
 * Regra obrigatória: só entra o que impacta o caixa (affects_cash_flow=true) —
 * compras individuais do cartão ficam de fora; a fatura entra consolidada no vencimento.
 */
export default function FluxoCaixaPage() {
  const supabase = createClient();
  const [period, setPeriod] = useState<string>("mes");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(p: string) {
    setLoading(true);
    setSelected(null);

    const today = new Date();
    let start: Date, end: Date;
    if (p === "mes") { start = startOfMonth(today); end = endOfMonth(today); }
    else if (p === "ano") { start = startOfYear(today); end = endOfYear(today); }
    else { start = today; end = addDays(today, parseInt(p, 10)); }

    const startISO = format(start, "yyyy-MM-dd");
    const endISO = format(end, "yyyy-MM-dd");

    const [{ data: before }, { data: dentro }] = await Promise.all([
      supabase.from("transactions")
        .select("amount")
        .eq("affects_cash_flow", true)
        .neq("status", "ignored")
        .lt("transaction_date", startISO),
      supabase.from("transactions")
        .select("transaction_date, amount, type, status, source, description_clean")
        .eq("affects_cash_flow", true)
        .neq("status", "ignored")
        .gte("transaction_date", startISO)
        .lte("transaction_date", endISO)
        .order("transaction_date"),
    ]);

    setSaldoInicial((before ?? []).reduce((s, t) => s + Number(t.amount), 0));
    setTxs((dentro as Tx[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(period); }, [period]);

  // Agrega por dia: recebido/pago, separando realizado × previsto
  const linhas = useMemo(() => {
    type Dia = { recebReal: number; recebPrev: number; pagReal: number; pagPrev: number };
    const dias = new Map<string, Dia>();
    for (const t of txs) {
      const d = dias.get(t.transaction_date) ?? { recebReal: 0, recebPrev: 0, pagReal: 0, pagPrev: 0 };
      const v = Number(t.amount);
      if (v >= 0) {
        if (isPrevisto(t.status)) d.recebPrev += v; else d.recebReal += v;
      } else {
        if (isPrevisto(t.status)) d.pagPrev += Math.abs(v); else d.pagReal += Math.abs(v);
      }
      dias.set(t.transaction_date, d);
    }
    const ordenado = [...dias.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let acumulado = saldoInicial;
    return ordenado.map(([date, d]) => {
      const receber = d.recebReal + d.recebPrev;
      const pagar = d.pagReal + d.pagPrev;
      const saldoDia = receber - pagar;
      acumulado += saldoDia;
      return { date, label: brDate(date).slice(0, 5), ...d, receber, pagar, saldoDia, acumulado };
    });
  }, [txs, saldoInicial]);

  const totalReceber = linhas.reduce((s, l) => s + l.receber, 0);
  const totalPagar = linhas.reduce((s, l) => s + l.pagar, 0);
  const saldoFinal = saldoInicial + totalReceber - totalPagar;

  // Detalhamento do dia selecionado
  const detalhe = useMemo(() => {
    if (!selected) return null;
    const doDia = txs.filter((t) => t.transaction_date === selected);
    const receitas = doDia.filter((t) => Number(t.amount) >= 0);
    const despesas = doDia.filter((t) => Number(t.amount) < 0);
    return { receitas, despesas };
  }, [selected, txs]);

  return (
    <>
      <Header title="Fluxo de caixa" />
      <div className="space-y-5 p-6">
        <div className="card flex flex-wrap items-center gap-2 p-4">
          <div className="flex flex-wrap rounded-full bg-slate-100 p-1 text-sm font-semibold">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={clsx("rounded-full px-4 py-1.5",
                  period === p.key ? "bg-white text-brand-600 shadow-card" : "text-ink-500")}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="ml-auto text-sm text-ink-500">
            Saldo inicial: <b className="text-ink-900">{brl(saldoInicial)}</b> ·
            A receber: <b className="text-success-fg">{brl(totalReceber)}</b> ·
            A pagar: <b className="text-danger-fg">{brl(totalPagar)}</b> ·
            Saldo final: <b className={saldoFinal >= saldoInicial ? "text-success-fg" : "text-danger-fg"}>{brl(saldoFinal)}</b>
          </p>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">A receber × a pagar, data a data</h2>
            <p className="text-xs text-ink-500">Tom escuro = realizado · tom claro = previsto · clique numa barra para ver o detalhe do dia</p>
          </div>
          {loading ? (
            <p className="py-10 text-center text-sm text-ink-500">Carregando…</p>
          ) : linhas.length ? (
            <div className="h-80">
              <ResponsiveContainer>
                <BarChart data={linhas} barGap={2}
                  onClick={(st: any) => {
                    const p = st?.activePayload?.[0]?.payload;
                    if (p?.date) setSelected(p.date);
                  }}>
                  <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748B" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748B" }}
                    tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip formatter={(v: number, name: string) => [brl(v), NOMES[name] ?? name]}
                    labelFormatter={(l) => `Dia ${l} — clique para detalhar`}
                    cursor={{ fill: "rgba(74,108,247,0.06)" }} />
                  <Legend iconType="circle" formatter={(v: string) => NOMES[v] ?? v} />
                  <Bar dataKey="recebReal" stackId="r" fill={COLORS.recebReal} radius={[0, 0, 0, 0]} cursor="pointer" />
                  <Bar dataKey="recebPrev" stackId="r" fill={COLORS.recebPrev} radius={[6, 6, 0, 0]} cursor="pointer" />
                  <Bar dataKey="pagReal" stackId="d" fill={COLORS.pagReal} radius={[0, 0, 0, 0]} cursor="pointer" />
                  <Bar dataKey="pagPrev" stackId="d" fill={COLORS.pagPrev} radius={[6, 6, 0, 0]} cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-ink-500">Nenhuma movimentação de caixa no período.</p>
          )}
        </div>

        {/* Detalhamento do dia selecionado */}
        {selected && detalhe && (
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">Detalhamento de {brDate(selected)}</h2>
              <button className="btn-ghost" onClick={() => setSelected(null)}>Fechar detalhe</button>
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-bold text-success-fg">
                  Receitas do dia — {brl(detalhe.receitas.reduce((s, t) => s + Number(t.amount), 0))}
                </h3>
                <ul className="divide-y divide-slate-100 text-sm">
                  {detalhe.receitas.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.description_clean ?? "Receita"}</p>
                        <Etiqueta previsto={isPrevisto(t.status)} />
                      </div>
                      <span className="font-semibold text-success-fg">{brl(Number(t.amount))}</span>
                    </li>
                  ))}
                  {detalhe.receitas.length === 0 && <li className="py-4 text-ink-500">Nenhuma receita nesse dia.</li>}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-bold text-danger-fg">
                  Despesas do dia — {brl(detalhe.despesas.reduce((s, t) => s + Math.abs(Number(t.amount)), 0))}
                </h3>
                <ul className="divide-y divide-slate-100 text-sm">
                  {detalhe.despesas.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.description_clean ?? "Despesa"}</p>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Etiqueta previsto={isPrevisto(t.status)} />
                          {t.source === "invoice_total" && (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-500">fatura de cartão</span>
                          )}
                        </span>
                      </div>
                      <span className="font-semibold text-danger-fg">{brl(Number(t.amount))}</span>
                    </li>
                  ))}
                  {detalhe.despesas.length === 0 && <li className="py-4 text-ink-500">Nenhuma despesa nesse dia.</li>}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Tabela diária: totais a receber × a pagar (clique na linha para detalhar) */}
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-right">A receber</th>
                <th className="px-4 py-3 text-right">A pagar</th>
                <th className="px-4 py-3 text-right">Saldo do dia</th>
                <th className="px-4 py-3 text-right">Saldo acumulado</th>
                <th className="px-4 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map((l) => (
                <tr key={l.date} onClick={() => setSelected(l.date)}
                  className={clsx("cursor-pointer hover:bg-slate-50/60", selected === l.date && "bg-brand-50/40")}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">{brDate(l.date)}</td>
                  <td className="px-4 py-2.5 text-right text-success-fg">
                    {l.receber ? brl(l.receber) : "—"}
                    {l.recebPrev > 0 && <p className="text-[11px] text-ink-500">sendo {brl(l.recebPrev)} previsto</p>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-danger-fg">
                    {l.pagar ? brl(l.pagar) : "—"}
                    {l.pagPrev > 0 && <p className="text-[11px] text-ink-500">sendo {brl(l.pagPrev)} previsto</p>}
                  </td>
                  <td className={clsx("px-4 py-2.5 text-right font-semibold", l.saldoDia >= 0 ? "text-success-fg" : "text-danger-fg")}>
                    {brl(l.saldoDia)}
                  </td>
                  <td className={clsx("px-4 py-2.5 text-right font-bold", l.acumulado >= 0 ? "text-ink-900" : "text-danger-fg")}>
                    {brl(l.acumulado)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {l.acumulado < 0 && <span className="rounded-md bg-danger-bg px-1.5 py-0.5 font-semibold text-danger-fg">saldo negativo</span>}{" "}
                    {(l.recebPrev > 0 || l.pagPrev > 0) && <span className="rounded-md bg-brand-50 px-1.5 py-0.5 font-semibold text-brand-600">contém previstos</span>}
                  </td>
                </tr>
              ))}
              {!loading && linhas.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-500">Nenhuma movimentação no período selecionado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
