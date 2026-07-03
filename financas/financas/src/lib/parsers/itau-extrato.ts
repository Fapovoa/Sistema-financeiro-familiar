import { ParsedTransaction, ParseResult } from "./types";
import { brDateToISO, cleanDescription, parseBRL } from "./normalize";
import { classifyType, suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// A extração pode vir com ou sem espaços entre colunas:
//   "23/03/2026 PIX QRS CARLOS ROBE21/03 -80,00"
//   "23/03/2026PIX QRS CARLOS ROBE21/03-80,00"
// Estratégia em 2 padrões para desambiguar valores grudados em números da descrição:
//   1) descrição termina em DD/MM (padrão do Itaú) e o valor vem em seguida
//   2) valor negativo (o "-" separa sozinho) ou positivo não precedido de dígito
const LINE_DDMM = /^(\d{2}\/\d{2}\/\d{4})\s*(.+?\d{2}\/\d{2})\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const LINE_GEN = /^(\d{2}\/\d{2}\/\d{4})\s*(.+?)\s*(-\d{1,3}(?:\.\d{3})*,\d{2}|(?<!\d)\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const SKIP = /(SALDO DO DIA|SALDO ANTERIOR|saldo em conta|per[ií]odo de visualiza|emitido em|extrato conta|lan[çc]amentos|Limite da Conta (utilizado|dispon|total)|Aviso!|Consultas|Reclama|Deficiente|Opera[çc][ãa]o|Resolu[çc][ãa]o)/i;

/** Extrato Itaú — robusto a texto com ou sem espaços entre colunas. */
export function parseItauExtrato(text: string): ParseResult {
  const txs: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || SKIP.test(line)) continue;

    const m = line.match(LINE_DDMM) ?? line.match(LINE_GEN);
    if (!m) continue;
    const [, date, desc, val] = m;

    const amount = parseBRL(val);
    if (!Number.isFinite(amount)) continue;

    const { type } = classifyType(desc, amount);
    const cat = suggestCategory(desc);
    const isFaturaPaga = /FATURA PAGA|PAG BOLETO NU PAGAMENTOS/i.test(desc);
    // Receitas são preenchidas manualmente: entradas não entram na importação
    if (amount > 0 && !isFaturaPaga) continue;

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
      affects_category_report: !isFaturaPaga,
      deduplication_status: isFaturaPaga ? "reconcile" : "new",
      suggested_action: isFaturaPaga ? "reconcile" : cat.confidence < 0.5 && type === "expense" ? "audit" : "import",
    });
  }
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido no extrato Itaú. [parser v3]");
  return { detected_type: "bank_statement", detected_institution: "Itaú (v3)", transactions: txs, warnings };
}
