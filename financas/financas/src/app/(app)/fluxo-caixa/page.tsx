import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/server";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { brl, brDate } from "@/lib/format";
import clsx from "clsx";
import { addDays, endOfMonth, endOfYear, format, startOfMonth, startOfYear } from "date-fns";

export const dynamic = "force-dynamic";

const PERIODS = [
  { key: "mes", label: "Mês atual" },
  { key: "30", label: "Próximos 30 dias" },
  { key: "60", label: "Próximos 60 dias" },
  { key: "90", label: "Próximos 90 dias" },
  { key: "ano", label: "Ano completo" },
] as const;

/**
 * Fluxo de caixa diário: cruza receitas e despesas realizadas e previstas.
 * Regra obrigatória: compras individuais do cartão NÃO entram aqui —
 * o que entra é o total da fatura na data de vencimento (affects_cash_flow=true).
 */
export default async function FluxoCaixaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const period = (PERIODS.find((p) => p.key === sp.periodo)?.key ?? "mes") as string;

  const today = new Date();
  let start: Date, end: Date;
  if (period === "mes") { start = startOfMonth(today); end = endOfMonth(today); }
  else if (period === "ano") { start = startOfYear(today); end = endOfYear(today); }
  else { start = today; end = addDays(today, parseInt(period, 10)); }

  const startISO = format(start, "yyyy-MM-dd");
  const endISO = format(end, "yyyy-MM-dd");
  const todayISO = format(today, "yyyy-MM-dd");

  const supabase = await createClient();

  // Saldo inicial: tudo que impactou o caixa antes do período
  const { data: before } = await supabase
    .from("transactions")
    .select("amount")
    .eq("affects_cash_flow", true)
    .neq("status", "ignored")
    .lt("transaction_date", startISO);
  const saldoInicial = (before ?? []).reduce((s, t) => s + Number(t.amount), 0);

  const { data: txs } = await supabase
    .from("transactions")
    .select("transaction_date, amount, type, status, source, description_clean")
    .eq("affects_cash_flow", true)
    .neq("status", "ignored")
    .gte("transaction_date", startISO)
    .lte("transaction_date", endISO)
    .order("transaction_date");

  // Agrupa por dia
  type Dia = { receitas: number; despesas: number; faturas: number; previsto: boolean; itens: string[] };
  const dias = new Map<string, Dia>();
  (txs ?? []).forEach((t) => {
    const d = dias.get(t.transaction_date) ?? { receitas: 0, despesas: 0, faturas: 0, previsto: false, itens: [] };
    const v = Number(t.amount);
    if (t.source === "invoice_total") { d.faturas += Math.abs(v); d.itens.push(t.description_clean ?? "Fatura"); }
    else if (v >= 0) d.receitas += v;
    else d.despesas += Math.abs(v);
    if (t.status === "forecast" || t.status === "pending") d.previsto = true;
    dias.set(t.transaction_date, d);
  });

  const ordenado = [...dias.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let acumulado = saldoInicial;
  const linhas = ordenado.map(([data, d]) => {
    const saldoDia = d.receitas - d.despesas - d.faturas;
    acumulado += saldoDia;
    return { data, ...d, saldoDia, acumulado };
  });

  const chart = linhas.map((l) => ({ label: brDate(l.data).slice(0, 5), value: Number(l.acumulado.toFixed(2)) }));
  const totalReceitas = linhas.reduce((s, l) => s + l.receitas, 0);
  const totalSaidas = linhas.reduce((s, l) => s + l.despesas + l.faturas, 0);

  return (
    <>
      <Header title="Fluxo de caixa" />
      <div className="space-y-5 p-6">
        <div className="card flex flex-wrap items-center gap-2 p-4">
          <div className="flex flex-wrap rounded-full bg-slate-100 p-1 text-sm font-semibold">
            {PERIODS.map((p) => (
              <Link key={p.key} href={`/fluxo-caixa?periodo=${p.key}`}
                className={clsx("rounded-full px-4 py-1.5",
                  period === p.key ? "bg-white text-brand-600 shadow-card" : "text-ink-500")}>
                {p.label}
              </Link>
            ))}
          </div>
          <p className="ml-auto text-sm text-ink-500">
            Saldo inicial: <b className="text-ink-900">{brl(saldoInicial)}</b> ·
            Entradas: <b className="text-success-fg">{brl(totalReceitas)}</b> ·
            Saídas: <b className="text-danger-fg">{brl(totalSaidas)}</b> ·
            Saldo final: <b className={acumulado >= saldoInicial ? "text-success-fg" : "text-danger-fg"}>{brl(acumulado)}</b>
          </p>
        </div>

        <div className="card p-5">
          <h2 className="mb-2 font-bold">Saldo acumulado no período</h2>
          {chart.length ? <AreaTrend data={chart} /> :
            <p className="py-10 text-center text-sm text-ink-500">Nenhuma movimentação de caixa no período.</p>}
        </div>

        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-right">Receitas</th>
                <th className="px-4 py-3 text-right">Despesas</th>
                <th className="px-4 py-3 text-right">Faturas de cartão</th>
                <th className="px-4 py-3 text-right">Saldo do dia</th>
                <th className="px-4 py-3 text-right">Saldo acumulado</th>
                <th className="px-4 py-3">Observações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map((l) => (
                <tr key={l.data} className={clsx("hover:bg-slate-50/60", l.data === todayISO && "bg-brand-50/40")}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                    {brDate(l.data)}
                    {l.data === todayISO && <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">hoje</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-success-fg">{l.receitas ? brl(l.receitas) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-danger-fg">{l.despesas ? brl(l.despesas) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-danger-fg">
                    {l.faturas ? brl(l.faturas) : "—"}
                    {l.faturas > 0 && <p className="text-[11px] text-ink-500">{l.itens.join(", ")}</p>}
                  </td>
                  <td className={clsx("px-4 py-2.5 text-right font-semibold", l.saldoDia >= 0 ? "text-success-fg" : "text-danger-fg")}>
                    {brl(l.saldoDia)}
                  </td>
                  <td className={clsx("px-4 py-2.5 text-right font-bold", l.acumulado >= 0 ? "text-ink-900" : "text-danger-fg")}>
                    {brl(l.acumulado)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {l.acumulado < 0 && <span className="rounded-md bg-danger-bg px-1.5 py-0.5 font-semibold text-danger-fg">saldo negativo</span>}{" "}
                    {l.previsto && <span className="rounded-md bg-brand-50 px-1.5 py-0.5 font-semibold text-brand-600">contém previstos</span>}
                  </td>
                </tr>
              ))}
              {linhas.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-500">Nenhuma movimentação no período selecionado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
