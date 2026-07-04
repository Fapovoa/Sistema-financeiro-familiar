import { ParsedTransaction, ParseResult } from "./types";
import { cleanDescription, detectInstallment, monthPtToNum, parseBRL } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// Extração real do PDF do Nubank: a DATA vem numa linha sozinha e a compra na seguinte:
//   "11 DEZ"
//   "•••• 0461Kiwify *Maf - Parcela 5/12R$ 82,42"
// Também suportamos o formato antigo com tudo na mesma linha.
const DATE_ONLY = /^(\d{1,2})\s+([A-Za-zç]{3})\s*$/;
const TX_BULLET = /^[•\u2022.]+\s*(\d{4})\s*(.+?)\s*(−|-)?\s*R\$\s*([\d.]+,\d{2})\s*$/;
const TX_INLINE = /^(\d{1,2})\s+([A-Za-zç]{3})[\s•\u2022.]*(?:\d{4})?\s*(.+?)\s*(−|-)?\s*R\$\s*([\d.]+,\d{2})\s*$/;
const SKIP = /(Pagamento em|Pagamento recebido|Saldo restante|RESUMO|TRANSA[ÇC][ÕO]ES|Total a pagar|Fatura anterior|Total de compras|Limite|Fechamento|Saldo em aberto|pagamento m[ií]nimo|Pagamento m[ií]nimo|Parcelar em|Valor de entrada|Valor da parcela|Juros|IOF|CET|Saque|Encargos|Ouvidoria|SAC\b|CNPJ|FATURA \d|EMISS[ÃA]O|Pagamentos e Financiamentos|Pagamentos de boleto|Pix no cr[ée]dito|Composi[çc][ãa]o|Alternativas)/i;

/** Fatura Nubank — data em linha própria + compra grudada na linha seguinte. */
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

  function toISO(dd: string, monPt: string): string | null {
    const mm = monthPtToNum(monPt);
    if (!mm) return null;
    let year = dueDate ? dueDate.getFullYear() : new Date().getFullYear();
    let iso = `${year}-${mm}-${dd.padStart(2, "0")}`;
    if (dueDate && new Date(iso + "T12:00:00") > dueDate) iso = `${year - 1}-${mm}-${dd.padStart(2, "0")}`;
    return iso;
  }

  const txs: ParsedTransaction[] = [];
  let currentISO: string | null = null;

  const push = (iso: string, desc: string, val: string, neg: boolean) => {
    const amount = parseBRL(val);
    if (!Number.isFinite(amount) || amount === 0 || neg) return; // negativos = pagamentos/estornos
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
  };

  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // linha só com a data ("11 DEZ") define a data das compras seguintes
    const d = line.match(DATE_ONLY);
    if (d && monthPtToNum(d[2])) { currentISO = toISO(d[1], d[2]); continue; }

    if (SKIP.test(line)) continue;

    // compra na linha seguinte à data: "•••• 0461DescriçãoR$ 99,99"
    const mb = line.match(TX_BULLET);
    if (mb && currentISO) {
      push(currentISO, mb[2].trim(), mb[4], !!mb[3]);
      continue;
    }
    // formato antigo: data + compra na mesma linha
    const mi = line.match(TX_INLINE);
    if (mi) {
      const iso = toISO(mi[1], mi[2]);
      if (iso) push(iso, mi[3].trim(), mi[5], !!mi[4]);
    }
  }

  if (!dueISO) warnings.push("Não foi possível identificar o vencimento da fatura Nubank.");
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido na fatura Nubank. [parser v4]");

  let closingISO: string | null = null;
  if (closingM) {
    const mm = monthPtToNum(closingM[2]);
    if (mm) closingISO = `${closingM[3]}-${mm}-${closingM[1].padStart(2, "0")}`;
  }

  return {
    detected_type: "credit_card_statement",
    detected_institution: "Nubank (v4)",
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
