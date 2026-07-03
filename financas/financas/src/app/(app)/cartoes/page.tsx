import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/server";
import { brl, brDate } from "@/lib/format";
import clsx from "clsx";
import { CreditCard } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_PT: Record<string, { label: string; cls: string }> = {
  open: { label: "aberta", cls: "bg-brand-50 text-brand-600" },
  closed: { label: "fechada", cls: "bg-warn-bg text-warn-fg" },
  paid: { label: "paga", cls: "bg-success-bg text-success-fg" },
  overdue: { label: "vencida", cls: "bg-danger-bg text-danger-fg" },
  forecast: { label: "prevista", cls: "bg-slate-100 text-ink-500" },
};

/**
 * Página específica de cartão de crédito.
 * Regra essencial: as compras listadas aqui alimentam a análise por categoria,
 * mas quem impacta o caixa é o lançamento consolidado da fatura no vencimento.
 */
export default async function CartoesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: cards } = await supabase
    .from("accounts")
    .select("id, name, institution, last_four_digits, credit_limit, closing_day, due_day")
    .eq("type", "credit_card")
    .order("name");

  const cardId = sp.cartao ?? cards?.[0]?.id ?? "";
  const card = (cards ?? []).find((c) => c.id === cardId);

  const { data: invoices } = cardId
    ? await supabase
        .from("credit_card_invoices")
        .select("id, reference_month, closing_date, due_date, total_amount, status")
        .eq("account_id", cardId)
        .order("reference_month", { ascending: false })
    : { data: [] as any[] };

  const invoiceId = sp.fatura ?? invoices?.[0]?.id ?? "";
  const invoice = (invoices ?? []).find((i) => i.id === invoiceId);

  // Compras da fatura selecionada (por competência) + parcelas futuras do cartão
  const [{ data: purchases }, { data: futureInst }] = await Promise.all([
    invoice
      ? supabase
          .from("transactions")
          .select("id, transaction_date, description_clean, description_original, amount, status, is_installment, installment_number, installment_total, confidence_score, categories(name, color)")
          .eq("account_id", cardId)
          .eq("is_card_purchase", true)
          .eq("competence_month", invoice.reference_month)
          .order("transaction_date", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    cardId
      ? supabase
          .from("transactions")
          .select("id, transaction_date, competence_month, description_clean, amount, installment_number, installment_total")
          .eq("account_id", cardId)
          .eq("status", "forecast")
          .eq("is_installment", true)
          .order("competence_month", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const list = purchases ?? [];
  const totalCompras = list.reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
  const comprometidoFuturo = (futureInst ?? []).reduce((s: number, t: any) => s + Math.abs(t.amount), 0);

  // Total por categoria dentro da fatura
  const porCat = new Map<string, { value: number; color: string }>();
  list.forEach((t: any) => {
    const name = t.categories?.name ?? "Não categorizado";
    const prev = porCat.get(name) ?? { value: 0, color: t.categories?.color ?? "#CBD5E1" };
    porCat.set(name, { ...prev, value: prev.value + Math.abs(t.amount) });
  });
  const cats = [...porCat.entries()].sort((a, b) => b[1].value - a[1].value);

  const limiteUsado = card?.credit_limit
    ? Math.min(100, Math.round(((Number(invoice?.total_amount ?? 0) + comprometidoFuturo) / Number(card.credit_limit)) * 100))
    : null;

  return (
    <>
      <Header title="Cartões de crédito" />
      <div className="space-y-5 p-6">
        {/* seletor de cartões */}
        <div className="flex flex-wrap gap-3">
          {(cards ?? []).map((c) => (
            <Link key={c.id} href={`/cartoes?cartao=${c.id}`}
              className={clsx("card flex min-w-56 items-center gap-3 px-4 py-3 transition",
                c.id === cardId ? "ring-2 ring-brand-500" : "hover:bg-slate-50")}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 text-white"><CreditCard size={18} /></span>
              <span>
                <p className="font-semibold leading-tight">{c.name}</p>
                <p className="text-xs text-ink-500">{c.institution} {c.last_four_digits && `•••• ${c.last_four_digits}`}</p>
              </span>
            </Link>
          ))}
          {(cards ?? []).length === 0 && (
            <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn-fg">
              Nenhum cartão cadastrado. Crie um em <a href="/contas" className="font-semibold underline">Contas &amp; cartões</a> (tipo “Cartão de crédito”).
            </p>
          )}
        </div>

        {card && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {/* faturas por competência */}
            <div className="card p-5">
              <h2 className="mb-3 font-bold">Faturas</h2>
              <ul className="space-y-2">
                {(invoices ?? []).map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/cartoes?cartao=${cardId}&fatura=${inv.id}`}
                      className={clsx("flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition",
                        inv.id === invoiceId ? "border-brand-500 bg-brand-50/60" : "border-slate-100 hover:bg-slate-50")}>
                      <span>
                        <p className="font-semibold">{new Date(inv.reference_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</p>
                        <p className="text-xs text-ink-500">vence {brDate(inv.due_date)}{inv.closing_date && ` · fecha ${brDate(inv.closing_date)}`}</p>
                      </span>
                      <span className="text-right">
                        <p className="font-bold">{brl(Number(inv.total_amount))}</p>
                        <span className={clsx("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", STATUS_PT[inv.status]?.cls)}>
                          {STATUS_PT[inv.status]?.label ?? inv.status}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {(invoices ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm text-ink-500">Importe uma fatura em PDF para começar.</p>
                )}
              </ul>

              {card.credit_limit && (
                <div className="mt-5">
                  <div className="mb-1 flex justify-between text-xs text-ink-500">
                    <span>Limite comprometido (fatura + parcelas futuras)</span><span>{limiteUsado}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${limiteUsado}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">Limite: {brl(Number(card.credit_limit))}</p>
                </div>
              )}
            </div>

            {/* detalhe da fatura */}
            <div className="card p-5 xl:col-span-2">
              {invoice ? (
                <>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="font-bold">
                        Fatura de {new Date(invoice.reference_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                      </h2>
                      <p className="text-sm text-ink-500">
                        {list.length} compras · total das compras {brl(totalCompras)} · fatura {brl(Number(invoice.total_amount))}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        O caixa é impactado apenas no vencimento ({brDate(invoice.due_date)}) pelo valor total da fatura.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {cats.slice(0, 6).map(([name, v]) => (
                        <span key={name} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs font-medium">
                          <span className="h-2 w-2 rounded-full" style={{ background: v.color }} />
                          {name} <b>{brl(v.value)}</b>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="max-h-96 overflow-auto rounded-xl border border-slate-100">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-ink-500">
                        <tr>
                          <th className="px-4 py-2.5">Data</th>
                          <th className="px-4 py-2.5">Estabelecimento</th>
                          <th className="px-4 py-2.5">Categoria</th>
                          <th className="px-4 py-2.5">Parcela</th>
                          <th className="px-4 py-2.5 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {list.map((t: any) => (
                          <tr key={t.id} className={clsx(t.status === "forecast" && "opacity-60")}>
                            <td className="whitespace-nowrap px-4 py-2">{brDate(t.transaction_date)}</td>
                            <td className="px-4 py-2">
                              <p className="font-medium">{t.description_clean}</p>
                              {t.status === "forecast" && <span className="text-[11px] font-semibold text-brand-600">prevista</span>}
                            </td>
                            <td className="px-4 py-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full" style={{ background: t.categories?.color ?? "#CBD5E1" }} />
                                {t.categories?.name ?? "Não categorizado"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs text-ink-500">
                              {t.is_installment ? `${t.installment_number}/${t.installment_total}` : "à vista"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-danger-fg">{brl(t.amount)}</td>
                          </tr>
                        ))}
                        {list.length === 0 && (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-500">Sem compras nesta competência.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="py-10 text-center text-sm text-ink-500">Selecione uma fatura ao lado.</p>
              )}

              {/* parcelas futuras comprometidas */}
              <div className="mt-5">
                <h3 className="mb-2 font-bold">Parcelas futuras comprometidas <span className="text-sm font-normal text-ink-500">— {brl(comprometidoFuturo)}</span></h3>
                <div className="flex flex-wrap gap-2">
                  {(futureInst ?? []).map((f: any) => (
                    <span key={f.id} className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700">
                      {f.description_clean} {f.installment_number}/{f.installment_total} ·{" "}
                      {new Date(f.competence_month + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })} · {brl(Math.abs(f.amount))}
                    </span>
                  ))}
                  {(futureInst ?? []).length === 0 && <p className="text-sm text-ink-500">Nenhuma parcela futura provisionada.</p>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
