import { ParsedTransaction, ParseResult } from "./types";
import { brDateToISO, cleanDescription, parseBRL } from "./normalize";
import { classifyType, suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

const LINE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const SKIP = /(SALDO DO DIA|saldo em conta|per[ií]odo de visualiza|emitido em|extrato conta)/i;

/** Extrato Itaú: "23/03/2026 PIX QRS FULANO -80,00" (linhas de SALDO DO DIA ignoradas). */
export function parseItauExtrato(text: string): ParseResult {
  const txs: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || SKIP.test(line)) continue;
    const m = line.match(LINE);
    if (!m) continue;
    const [, date, desc, val] = m;
    if (/SALDO DO DIA/i.test(desc)) continue;

    const amount = parseBRL(val);
    if (!Number.isFinite(amount)) continue;

    const { type } = classifyType(desc, amount);
    const cat = suggestCategory(desc);
    const isFaturaPaga = /FATURA PAGA|PAG BOLETO NU PAGAMENTOS/i.test(desc);

    txs.push({
      transaction_date: brDateToISO(date),
      description_original: desc,
      description_clean: cleanDescription(desc),
      amount,
      type: isFaturaPaga ? "credit_card_payment" : type,
      category_suggestion: isFaturaPaga ? "Cartão de crédito" : cat.category,
      confidence_score: isFaturaPaga ? 0.95 : cat.confidence,
      is_installment: false,
      installment_number: null,
      installment_total: null,
      is_recurring_candidate: isRecurringCandidate(desc),
      is_card_purchase: false,
      affects_cash_flow: true,
      affects_category_report: !isFaturaPaga, // pagamento de fatura não vira "despesa por categoria"
      deduplication_status: isFaturaPaga ? "reconcile" : "new",
      suggested_action: isFaturaPaga ? "reconcile" : cat.confidence < 0.5 && type === "expense" ? "audit" : "import",
    });
  }
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido no extrato Itaú.");
  return { detected_type: "bank_statement", detected_institution: "Itaú", transactions: txs, warnings };
}
