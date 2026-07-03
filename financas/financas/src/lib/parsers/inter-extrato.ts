import { ParsedTransaction, ParseResult } from "./types";
import { cleanDescription, monthPtToNum, parseBRL } from "./normalize";
import { classifyType, suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// Com ou sem espaços:
//   '1 de Janeiro de 2026 Saldo do dia: R$ 96,24'
//   'Pix enviado: "Cp :10573521-Roberto" -R$ 19,00 R$ 96,24'  (1º valor = transação, 2º = saldo)
// O "R$" antes de cada valor torna a leitura segura mesmo com texto grudado.
const DAY = /^(\d{1,2})\s*de\s*([A-Za-zç]+)\s*de\s*(\d{4})\s*Saldo do dia/i;
const TX = /^(Pix enviado|Pix recebido|Compra no debito|Compra Meio De Transporte|Pagamento efetuado|Pagamento de Convenio|Boleto de cobranca recebido|Pagamento recebido)\s*:\s*"?(.*?)"?\s*(-?)\s*R\$\s*([\d.]+,\d{2})\s*-?\s*R\$\s*[\d.]+,\d{2}\s*$/i;

/** Extrato Banco Inter — robusto a texto com ou sem espaços. */
export function parseInterExtrato(text: string): ParseResult {
  const txs: ParsedTransaction[] = [];
  const warnings: string[] = [];
  let currentISO: string | null = null;

  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const d = line.match(DAY);
    if (d) {
      const mm = monthPtToNum(d[2]);
      if (mm) currentISO = `${d[3]}-${mm}-${d[1].padStart(2, "0")}`;
      continue;
    }
    const m = line.match(TX);
    if (!m || !currentISO) continue;

    const [, kind, descRaw, neg, valRaw] = m;
    let amount = parseBRL(valRaw);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (neg === "-") amount = -Math.abs(amount);
    else if (/enviado|efetuado|debito|transporte|convenio/i.test(kind)) amount = -Math.abs(amount);

    const desc = descRaw
      .replace(/^Cp :\d+-?/, "")
      .replace(/^No estabelecimento\s+/i, "")
      .trim();
    const full = `${kind}: ${desc}`;
    const cat = suggestCategory(desc);
    let { type } = classifyType(full, amount);
    if (type === "transfer") type = amount < 0 ? "expense" : "income";
    const isCardPay = /nu pagamentos|pagamento de fatura|fatura/i.test(desc) && /pagamento/i.test(kind);

    txs.push({
      transaction_date: currentISO,
      description_original: full,
      description_clean: cleanDescription(desc),
      amount,
      type: isCardPay ? "credit_card_payment" : type,
      category_suggestion: cat.category,
      confidence_score: cat.confidence,
      is_installment: false,
      installment_number: null,
      installment_total: null,
      is_recurring_candidate: isRecurringCandidate(desc),
      is_card_purchase: false,
      affects_cash_flow: true,
      affects_category_report: !isCardPay,
      deduplication_status: isCardPay ? "reconcile" : "new",
      suggested_action: isCardPay ? "reconcile" : cat.confidence < 0.5 && type === "expense" ? "audit" : "import",
    });
  }
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido no extrato Inter. [parser v3]");
  return { detected_type: "bank_statement", detected_institution: "Banco Inter (v3)", transactions: txs, warnings };
}
