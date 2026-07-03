import { Header } from "@/components/layout/Header";
import { StatCard } from "@/components/ui/StatCard";
import { Donut } from "@/components/charts/Donut";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarsCompare } from "@/components/charts/BarsCompare";
import { createClient } from "@/lib/supabase/server";
import { brl, brDate, monthLabel } from "@/lib/format";
import { Banknote, CreditCard, PiggyBank, ReceiptText, AlertTriangle } from "lucide-react";
import { addDays, endOfMonth, format, startOfMonth, subMonths } from "date-fns";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const today = new Date();
  const mStart = format(startOfMonth(today), "yyyy-MM-dd");
  const mEnd = format(endOfMonth(today), "yyyy-MM-dd");
  const sixAgo = format(startOfMonth(subMonths(today, 5)), "yyyy-MM-dd");
  const in30 = format(addDays(today, 30), "yyyy-MM-dd");
  const todayISO = format(today, "yyyy-MM-dd");

  const [{ data: txs }, { data: cats }, { data: invoices }, { count: auditCount }] = await Promise.all([
    supabase.from("transactions")
      .select("amount, type, transaction_date, status, category_id, affects_cash_flow, affects_category_report, description_clean, is_card_purchase, source")
      .gte("transaction_date", sixAgo).lte("transaction_date", in30)
      .neq("status", "ignored"),
    supabase.from("categories").select("id, name, color, type"),
    supabase.from("credit_card_invoices").select("total_amount, due_date, status")
      .gte("due_date", todayISO).lte("due_date", in30).neq("status", "paid"),
    supabase.from("audit_items").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const catMap = new Map((cats ?? []).map((c) => [c.id, c]));
  const all = txs ?? [];
  const inMonth = all.filter((t) => t.transaction_date >= mStart && t.transaction_date <= mEnd);

  // Visão de caixa: só o que impacta o caixa (fatura consolidada, não compras do cartão)
  const receitasMes = inMonth.filter((t) => t.type === "income" && t.affects_cash_flow && t.status !== "forecast")
    .reduce((s, t) => s + t.amount, 0);
  const despesasMesCaixa = inMonth.filter((t) => t.amount < 0 && t.affects_cash_flow && t.status !== "forecast")
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const resultado = receitasMes - despesasMesCaixa;

  const previstas = all.filter((t) => t.status === "forecast" && t.transaction_date >= todayISO)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const faturas30 = (invoices ?? []).reduce((s, i) => s + Number(i.total_amount), 0);

  // Análise por categoria: lançamentos individuais (inclui compras de cartão)
  const porCategoria = new Map<string, number>();
  inMonth.filter((t) => t.amount < 0 && t.affects_category_report && t.type === "expense")
    .forEach((t) => {
      const name = catMap.get(t.category_id ?? "")?.name ?? "Não categorizado";
      porCategoria.set(name, (porCategoria.get(name) ?? 0) + Math.abs(t.amount));
    });
  const donutData = [...porCategoria.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, value]) => ({
      name, value,
      color: (cats ?? []).find((c) => c.name === name)?.color ?? "#94A3B8",
    }));
  const totalCategorias = donutData.reduce((s, d) => s + d.value, 0);

  // Evolução 6 meses (caixa)
  const evolucao: { label: string; receitas: number; despesas: number; saldo: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const ref = subMonths(today, i);
    const s = format(startOfMonth(ref), "yyyy-MM-dd");
    const e = format(endOfMonth(ref), "yyyy-MM-dd");
    const slice = all.filter((t) => t.transaction_date >= s && t.transaction_date <= e && t.affects_cash_flow && t.status !== "forecast");
    const rec = slice.filter((t) => t.type === "income").reduce((x, t) => x + t.amount, 0);
    const des = slice.filter((t) => t.amount < 0).reduce((x, t) => x + Math.abs(t.amount), 0);
    evolucao.push({ label: monthLabel(s), receitas: rec, despesas: des, saldo: rec - des });
  }
  let acc = 0;
  const saldoAcumulado = evolucao.map((m) => ({ label: m.label, value: (acc += m.saldo) }));

  const top10 = inMonth
    .filter((t) => t.amount < 0 && t.affects_category_report && t.status !== "forecast")
    .sort((a, b) => a.amount - b.amount).slice(0, 10);

  const comprometimento = receitasMes > 0 ? Math.round((despesasMesCaixa / receitasMes) * 100) : null;

  const alerts: { tone: "danger" | "warn" | "info"; text: string }[] = [];
  if (resultado < 0) alerts.push({ tone: "danger", text: "Seu mês está projetado para fechar negativo." });
  if (previstas > 0) alerts.push({ tone: "warn", text: `Você tem ${brl(previstas)} em despesas futuras já provisionadas.` });
  if (faturas30 > 0) alerts.push({ tone: "warn", text: `Você tem ${brl(faturas30)} em faturas de cartão com vencimento nos próximos 30 dias.` });
  if ((auditCount ?? 0) > 0) alerts.push({ tone: "info", text: `Existem ${auditCount} lançamentos pendentes de auditoria.` });
  if (comprometimento !== null && comprometimento > 80) alerts.push({ tone: "danger", text: `Comprometimento da renda em ${comprometimento}% neste mês.` });

  return (
    <>
      <Header title="Dashboard" />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Banknote} label="Receitas do mês" value={brl(receitasMes)}
            badge={{ text: comprometimento !== null ? `${100 - Math.min(comprometimento, 100)}% livre` : "—", tone: "up" }}
            spark={evolucao.map((m) => m.receitas)} sparkKind="bars" />
          <StatCard icon={ReceiptText} label="Despesas do mês (caixa)" value={brl(despesasMesCaixa)}
            badge={{ text: comprometimento !== null ? `${comprometimento}% da renda` : "—", tone: comprometimento && comprometimento > 80 ? "down" : "neutral" }}
            spark={evolucao.map((m) => m.despesas)} />
          <StatCard icon={PiggyBank} label="Resultado do mês" value={brl(resultado)}
            badge={{ text: resultado >= 0 ? "Positivo" : "Negativo", tone: resultado >= 0 ? "up" : "down" }}
            spark={evolucao.map((m) => m.saldo)} sparkKind="bars" />
          <StatCard icon={CreditCard} label="Faturas nos próximos 30 dias" value={brl(faturas30)}
            badge={{ text: `${(invoices ?? []).length} fatura(s)`, tone: "neutral" }}
            spark={saldoAcumulado.map((m) => m.value)} />
        </div>

        {alerts.length > 0 && (
          <div className="card p-5">
            <h2 className="mb-3 font-bold">Alertas financeiros</h2>
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  a.tone === "danger" ? "bg-danger-bg text-danger-fg" :
                  a.tone === "warn" ? "bg-warn-bg text-warn-fg" : "bg-brand-50 text-brand-700"}`}>
                  <AlertTriangle size={15} /> {a.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="card p-5 xl:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-bold">Despesas por categoria</h2>
              <span className="text-xs text-ink-500">visão analítica</span>
            </div>
            {donutData.length ? (
              <>
                <Donut data={donutData} centerLabel="Total" centerValue={brl(totalCategorias)} />
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {donutData.map((d) => (
                    <li key={d.name} className="flex items-center gap-2 truncate">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="truncate text-ink-700">{d.name}</span>
                      <span className="ml-auto font-semibold">{brl(d.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <EmptyHint />}
          </div>
          <div className="card p-5 xl:col-span-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-bold">Saldo acumulado</h2>
              <span className="text-xs text-ink-500">últimos 6 meses · visão de caixa</span>
            </div>
            <AreaTrend data={saldoAcumulado} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="card p-5 xl:col-span-3">
            <h2 className="mb-2 font-bold">Receitas × despesas por mês</h2>
            <BarsCompare data={evolucao} />
          </div>
          <div className="card p-5 xl:col-span-2">
            <h2 className="mb-3 font-bold">Top 10 despesas do mês</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {top10.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.description_clean}</p>
                    <p className="text-xs text-ink-500">
                      {brDate(t.transaction_date)} · {catMap.get(t.category_id ?? "")?.name ?? "Não categorizado"}
                      {t.is_card_purchase && " · cartão"}
                    </p>
                  </div>
                  <span className="font-semibold text-danger-fg">{brl(t.amount)}</span>
                </li>
              ))}
              {top10.length === 0 && <EmptyHint />}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function EmptyHint() {
  return (
    <p className="py-10 text-center text-sm text-ink-500">
      Nenhum dado ainda. Importe um extrato ou fatura em <span className="font-semibold text-brand-600">Importar PDFs</span>.
    </p>
  );
}
