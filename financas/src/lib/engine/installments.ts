import { addMonths, format, parseISO } from "date-fns";

export type FutureInstallment = {
  installment_number: number;
  transaction_date: string;       // data prevista (mesmo dia, meses seguintes)
  invoice_reference_month: string; // yyyy-mm da fatura futura
  amount: number;
};

/**
 * A partir da parcela atual (ex.: 3/12 em fev/2026), projeta as parcelas restantes
 * nas competências futuras. Cada parcela futura nasce como status "forecast",
 * dentro da fatura futura correspondente (affects_cash_flow=false).
 */
export function projectFutureInstallments(params: {
  currentNumber: number;
  totalInstallments: number;
  amount: number;                 // valor da parcela (negativo)
  purchaseDateISO: string;
  invoiceRefMonth: string;        // yyyy-mm da fatura em que a parcela atual apareceu
}): FutureInstallment[] {
  const out: FutureInstallment[] = [];
  const base = parseISO(params.invoiceRefMonth + "-01");
  for (let n = params.currentNumber + 1; n <= params.totalInstallments; n++) {
    const offset = n - params.currentNumber;
    const ref = addMonths(base, offset);
    out.push({
      installment_number: n,
      transaction_date: format(addMonths(parseISO(params.purchaseDateISO), offset), "yyyy-MM-dd"),
      invoice_reference_month: format(ref, "yyyy-MM"),
      amount: params.amount,
    });
  }
  return out;
}
