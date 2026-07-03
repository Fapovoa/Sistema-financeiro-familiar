import { ParsedTransaction, ParseResult } from "./types";
import { brDateToISO, cleanDescription, detectInstallment, parseBRL } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

const TX = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const SKIP = /(SALDO|Total d|Total p|Pr[óo]xima fatura|Demais faturas|Limite|Juros|IOF|Multa|Encargos|DATA\s+ESTABELECIMENTO|PAGAMENTO\b|Total dos pagamentos|Lan[çc]amentos no cart|Repasse|D[óo]lar|Total (transa|lan[çc]amentos))/i;

/** Fatura Itaú: "28/12 METRO RJ... 7,90" (valor positivo = despesa). */
export function parseItauFatura(text: string): ParseResult {
  const warnings: string[] = [];

  const due = text.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const closing = text.match(/Fechamento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const total = text.match(/Total desta fatura\s+([\d.]+,\d{2})/i);

  const dueISO = due ? brDateToISO(due[1]) : null;
  const dueDate = dueISO ? new Date(dueISO + "T12:00:00") : null;
  const refMonth = dueISO ? dueISO.slice(0, 7) : null;

  // Seção de parcelas futuras não deve virar lançamento desta fatura
  const cutIdx = text.search(/Compras?\s+par?cel?adas?\s*-\s*pr[óo]?x/i);
  const body = cutIdx > 0 ? text.slice(0, cutIdx) : text;

  const txs: ParsedTransaction[] = [];
  for (const raw of body.split(/\n/)) {
    const line = raw.trim();
    if (!line || SKIP.test(line)) continue;
    const m = line.match(TX);
    if (!m) continue;
    const [, ddmm, desc, val] = m;

    const amount = parseBRL(val);
    if (!Number.isFinite(amount) || amount === 0) continue;

    // Inferência de ano: compras podem ser do ano anterior ao vencimento
    let year = dueDate ? dueDate.getFullYear() : new Date().getFullYear();
    const [dd, mm] = ddmm.split("/");
    let iso = `${year}-${mm}-${dd}`;
    if (dueDate && new Date(iso + "T12:00:00") > dueDate) {
      iso = `${year - 1}-${mm}-${dd}`;
    }

    const inst = detectInstallment(desc);
    const cat = suggestCategory(desc);
    const isPayment = /PAGAMENTO/i.test(desc);
    if (isPayment) continue;

    txs.push({
      transaction_date: iso,
      description_original: desc,
      description_clean: cleanDescription(desc.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, "")),
      amount: -Math.abs(amount),           // fatura lista despesas como positivas
      type: amount < 0 ? "refund" : "expense",
      category_suggestion: cat.category,
      confidence_score: cat.confidence,
      is_installment: !!inst,
      installment_number: inst?.current ?? null,
      installment_total: inst?.total ?? null,
      is_recurring_candidate: isRecurringCandidate(desc),
      is_card_purchase: true,
      invoice_reference_month: refMonth,
      invoice_due_date: dueISO,
      affects_cash_flow: false,            // regra-chave: compra de cartão não bate no caixa
      affects_category_report: true,
      deduplication_status: "new",
      suggested_action: cat.confidence < 0.5 ? "audit" : "import",
    });
  }
  if (!dueISO) warnings.push("Não foi possível identificar a data de vencimento da fatura.");
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido na fatura Itaú.");

  return {
    detected_type: "credit_card_statement",
    detected_institution: "Itaú",
    invoice: {
      total_amount: total ? parseBRL(total[1]) : null,
      due_date: dueISO,
      closing_date: closing ? brDateToISO(closing[1]) : null,
      reference_month: refMonth,
    },
    transactions: txs,
    warnings,
  };
}
