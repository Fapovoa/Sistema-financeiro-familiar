import { addMonths, format, parseISO } from "date-fns";

/**
 * Projeta as próximas N ocorrências de uma regra de recorrência mensal.
 * Se a regra for de cartão, o lançamento previsto entra na fatura futura
 * (affects_cash_flow=false); se for de conta, entra direto no fluxo previsto.
 */
export function projectRecurrences(params: {
  lastDateISO: string;
  amount: number;
  months?: number;
}): { transaction_date: string; competence_month: string; amount: number }[] {
  const months = params.months ?? 3;
  const base = parseISO(params.lastDateISO);
  const out = [];
  for (let i = 1; i <= months; i++) {
    const d = addMonths(base, i);
    out.push({
      transaction_date: format(d, "yyyy-MM-dd"),
      competence_month: format(d, "yyyy-MM"),
      amount: params.amount,
    });
  }
  return out;
}
