import { ParsedTransaction, ParseResult } from "./types";
import { cleanDescription, monthPtToNum, parseBRL } from "./normalize";
import { classifyType, suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

const DAY = /^(\d{1,2})\s+de\s+([A-Za-zç]+)\s+de\s+(\d{4})\s+Saldo do dia/i;
// 'Pix enviado: "Cp :123-Fulano" -R$ 19,00 R$ 96,24'  (1º valor = transação, 2º = saldo)
const TX = /^(Pix enviado|Pix recebido|Compra no debito|Compra Meio De Transporte|Pagamento efetuado|Pagamento de Convenio|Boleto de cobranca recebido):\s*"?(.*?)"?\s+(-?R\$\s*[\d.]+,\d{2})\s+(-?R\$\s*[\d.]+,\d{2})\s*$/i;

/** Extrato Banco Inter: cabeçalho por dia + linhas com valor e saldo por transação. */
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

    const [, kind, descRaw, valRaw] = m;
    const amount = parseBRL(valRaw);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const desc = descRaw
      .replace(/^Cp :\d+-?/, "")
      .replace(/^No estabelecimento\s+/i, "")
      .trim();
    const full = `${kind}: ${desc}`;
    const cat = suggestCategory(desc);
    let { type } = classifyType(full, amount);
    // PIX no Inter é o meio de pagamento padrão: se a categoria é reconhecida
    // (mercado, saúde, casa…), trata como despesa/receita, não transferência.
    if (type === "transfer" && cat.category) type = amount < 0 ? "expense" : "income";
    // PIX para pessoa física sem categoria: mantém como despesa de baixa confiança -> auditoria
    if (type === "transfer" && !cat.category) type = amount < 0 ? "expense" : "income";
    const isCardPay = /nu pagamentos|pagamento de fatura|fatura/i.test(desc) && kind.toLowerCase().includes("pagamento");

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
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido no extrato Inter.");
  return { detected_type: "bank_statement", detected_institution: "Banco Inter", transactions: txs, warnings };
}
