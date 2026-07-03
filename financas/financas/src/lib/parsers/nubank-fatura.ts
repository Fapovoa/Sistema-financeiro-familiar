import { ParsedTransaction, ParseResult } from "./types";
import { cleanDescription, detectInstallment, monthPtToNum, parseBRL } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// Com ou sem espaços: "11 DEZ •••• 0461 Kiwify *Maf - Parcela 5/12 R$ 82,42"
//                     "11 DEZ•••• 0461Kiwify *Maf - Parcela 5/12R$ 82,42"
// O "R$" antes de todo valor torna a leitura segura mesmo grudada.
const TX = /^(\d{1,2})\s*([A-Za-zç]{3})[\s•\.\u2022]*(?:\d{4})?\s*(.+?)\s*(−|-)?R\$\s*([\d.]+,\d{2})\s*$/;
const SKIP = /(Pagamento em|Saldo restante|RESUMO|TRANSA[ÇC][ÕO]ES|Total a pagar|Fatura anterior|Pagamento recebido|Total de compras|Limite|Fechamento|Saldo em aberto|pagamento m[ií]nimo|Parcelar em|Valor de entrada|Valor da parcela|Juros|IOF|CET|Saque|Encargos|Ouvidoria|SAC\b|CNPJ)/i;

/** Fatura Nubank — robusto a texto com ou sem espaços. */
export function parseNubankFatura(text: string): ParseResult {
  const warnings: string[] = [];

  const dueM = text.match(/Data de vencimento:\s*(\d{1,2})\s*([A-Za-zç]{3})\s*(\d{4})/i);
  const totalM = text.match(/no valor de\s*R\$\s*([\d.]+,\d{2})/i) || text.match(/Total a pagar\s*R\$\s*([\d.]+,\d{2})/i);
  const closingM = text.match(/Fechamento da pr[óo]xima fatura\s*(\d{1,2})\s*([A-Za-zç]{3})\s*(\d{4})/i);

  let dueISO: string | null = null;
  if (dueM) {
    const mm = monthPtToNum(dueM[2]);
    if (mm) dueISO = `${dueM[3]}-${mm}-${dueM[1].padStart(2, "0")}`;
  }
  const dueDate = dueISO ? new Date(dueISO + "T12:00:00") : null;
  const refMonth = dueISO ? dueISO.slice(0, 7) : null;

  const txs: ParsedTransaction[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || SKIP.test(line)) continue;
    const m = line.match(TX);
    if (!m) continue;
    const [, dd, monPt, desc, neg, val] = m;
    const mm = monthPtToNum(monPt);
    if (!mm) continue;

    const amount = parseBRL(val);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (neg) continue; // "−R$": pagamento/estorno da fatura anterior — reconciliação, não despesa

    let year = dueDate ? dueDate.getFullYear() : new Date().getFullYear();
    let iso = `${year}-${mm}-${dd.padStart(2, "0")}`;
    if (dueDate && new Date(iso + "T12:00:00") > dueDate) iso = `${year - 1}-${mm}-${dd.padStart(2, "0")}`;

    const inst = detectInstallment(desc);
    const cat = suggestCategory(desc);

    txs.push({
      transaction_date: iso,
      description_original: desc,
      description_clean: cleanDescription(desc.replace(/\s*-\s*Parcela\s*\d+\/\d+\s*$/i, "")),
      amount: -Math.abs(amount),
      type: "expense",
      category_suggestion: cat.category,
      confidence_score: cat.confidence,
      is_installment: !!inst,
      installment_number: inst?.current ?? null,
      installment_total: inst?.total ?? null,
      is_recurring_candidate: isRecurringCandidate(desc),
      is_card_purchase: true,
      invoice_reference_month: refMonth,
      invoice_due_date: dueISO,
      affects_cash_flow: false,
      affects_category_report: true,
      deduplication_status: "new",
      suggested_action: cat.confidence < 0.5 ? "audit" : "import",
    });
  }
  if (!dueISO) warnings.push("Não foi possível identificar o vencimento da fatura Nubank.");
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido na fatura Nubank. [parser v3]");

  let closingISO: string | null = null;
  if (closingM) {
    const mm = monthPtToNum(closingM[2]);
    if (mm) closingISO = `${closingM[3]}-${mm}-${closingM[1].padStart(2, "0")}`;
  }

  return {
    detected_type: "credit_card_statement",
    detected_institution: "Nubank (v3)",
    invoice: {
      total_amount: totalM ? parseBRL(totalM[1]) : null,
      due_date: dueISO,
      closing_date: closingISO,
      reference_month: refMonth,
    },
    transactions: txs,
    warnings,
  };
}
