import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ManualExpenseForm } from "@/components/ManualExpenseForm";
import { DespesasTable } from "@/components/DespesasTable";
import { createClient } from "@/lib/supabase/server";
import { brl, brDate } from "@/lib/format";
import clsx from "clsx";
import {
  startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, format,
} from "date-fns";

export const dynamic = "force-dynamic";

// Períodos fixos + Personalizado (intervalo escolhido por você).
const PERIODS = [
  { key: "mes", label: "Mês atual" },
  { key: "mes-passado", label: "Mês passado" },
  { key: "3m", label: "Último trimestre" },
  { key: "6m", label: "Último semestre" },
  { key: "ano", label: "Ano atual" },
  { key: "personalizado", label: "Personalizado" },
] as const;

function resolvePeriodo(periodo: string, de: string, ate: string) {
  const hoje = new Date();
  let start: Date, end: Date;
  switch (periodo) {
    case "mes-passado": {
      const ref = subMonths(hoje, 1);
      start = startOfMonth(ref); end = endOfMonth(ref); break;
    }
    case "3m": start = startOfMonth(subMonths(hoje, 2)); end = endOfMonth(hoje); break;
    case "6m": start = startOfMonth(subMonths(hoje, 5)); end = endOfMonth(hoje); break;
    case "ano": start = startOfYear(hoje); end = endOfYear(hoje); break;
    case "personalizado": {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(de) ? new Date(de + "T12:00:00") : startOfMonth(hoje);
      const a = /^\d{4}-\d{2}-\d{2}$/.test(ate) ? new Date(ate + "T12:00:00") : endOfMonth(hoje);
      start = d <= a ? d : a;
      end = d <= a ? a : d;
      break;
    }
    default: start = startOfMonth(hoje); end = endOfMonth(hoje);
  }
  return { startISO: format(start, "yyyy-MM-dd"), endISO: format(end, "yyyy-MM-dd") };
}

/**
 * Página geral de despesas com duas visões:
 * - caixa: só affects_cash_flow=true (fatura total no vencimento; compras do cartão ficam de fora)
 * - analitica: só affects_category_report=true (compras individuais do cartão entram aqui)
 * A tabela (com edição) é um componente client; a leitura continua no server.
 */
export default async function DespesasPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const view = sp.view === "analitica" ? "analitica" : "caixa";
  const periodo = (PERIODS.find((p) => p.key === sp.periodo)?.key ?? "mes") as string;
  const de = sp.de ?? "";
  const ate = sp.ate ?? "";
  const catFilter = sp.categoria ?? "";
  const status = sp.status ?? "";
  const q = sp.q ?? "";

  const { startISO, endISO } = resolvePeriodo(periodo, de, ate);
  const periodoLabel = PERIODS.find((p) => p.key === periodo)?.label ?? "Mês atual";

  const supabase = await createClient();

  let query = supabase.from("transactions")
    .select("id, transaction_date, due_date, description_clean, description_original, amount, status, source, is_card_purchase, is_installment, installment_number, installment_total, is_recurring, category_id, categories(name, color)")
    .lt("amount", 0)
    .neq("type", "ignored")
    .gte("transaction_date", startISO).lte("transaction_date", endISO)
    .order("transaction_date", { ascending: false })
    .limit(2000);

  query = view === "caixa"
    ? query.eq("affects_cash_flow", true)
    : query.eq("affects_category_report", true);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("description_clean", `%${q}%`);

  const { data: txs } = await query;
  const { data: cats } = await supabase.from("categories").select("id, name").eq("type", "expense").order("name");

  const list = (txs ?? []).filter((t: any) => !catFilter || t.categories?.name === catFilter);
  const total = list.reduce((s: number, t: any) => s + Math.abs(t.amount), 0);

  const mkHref = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ view, periodo, de, ate, categoria: catFilter, status, q, ...patch });
    [...p.entries()].forEach(([k, v]) => !v && p.delete(k));
    return `/despesas?${p.toString()}`;
  };

  return (
    <>
      <Header title="Despesas" />
      <div className="space-y-5 p-6">
        <ManualExpenseForm />
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="flex rounded-full bg-slate-100 p-1 text-sm font-semibold">
            <Link href={mkHref({ view: "caixa" })}
              className={clsx("rounded-full px-4 py-1.5", view === "caixa" ? "bg-white text-brand-600 shadow-card" : "text-ink-500")}>
              Visão de caixa
            </Link>
            <Link href={mkHref({ view: "analitica" })}
              className={clsx("rounded-full px-4 py-1.5", view === "analitica" ? "bg-white text-brand-600 shadow-card" : "text-ink-500")}>
              Visão analítica
            </Link>
          </div>
          <form className="ml-auto flex flex-wrap items-end gap-2" action="/despesas">
            <input type="hidden" name="view" value={view} />
            <label className="text-sm">
              <span className="mb-1 block font-medium">Período</span>
              <select name="periodo" defaultValue={periodo} className="input w-auto">
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">De</span>
              <input type="date" name="de" defaultValue={de} className="input w-auto" title="Usado só quando o período é Personalizado" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Até</span>
              <input type="date" name="ate" defaultValue={ate} className="input w-auto" title="Usado só quando o período é Personalizado" />
            </label>
            <select name="categoria" defaultValue={catFilter} className="input w-auto">
              <option value="">Todas as categorias</option>
              {(cats ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <select name="status" defaultValue={status} className="input w-auto">
              <option value="">Todos os status</option>
              <option value="paid">Pago</option>
              <option value="pending">Pendente</option>
              <option value="forecast">Previsto</option>
              <option value="confirmed">Confirmado</option>
            </select>
            <input name="q" defaultValue={q} placeholder="Buscar descrição…" className="input w-44" />
            <button className="btn-ghost">Filtrar</button>
          </form>
        </div>

        <p className="text-sm text-ink-500">
          {view === "caixa"
            ? "Impacto real no caixa: faturas de cartão aparecem consolidadas na data de vencimento; compras individuais do cartão não são somadas aqui."
            : "Visão analítica: compras individuais do cartão entram por categoria; o total consolidado da fatura fica de fora para não duplicar."}{" "}
          Período: <b className="text-ink-900">{periodoLabel}</b> ({brDate(startISO)} a {brDate(endISO)}) ·
          Total: <b className="text-ink-900">{brl(total)}</b> · {list.length} lançamentos.
          <span className="block text-xs text-ink-400">As datas “De/Até” só valem quando o período está em “Personalizado”.</span>
        </p>

        <DespesasTable rows={list as any} cats={cats ?? []} />
      </div>
    </>
  );
}
