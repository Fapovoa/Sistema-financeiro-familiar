import { ParsedTransaction, ParseResult } from "./types";
import { brDateToISO, cleanDescription, detectInstallment, parseBRL } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// Linha de compra: "28/05 IVAN SOUZA 11/12 164,63"  (dd/mm  estabelecimento  valor)
const TX = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

// Linhas que NÃO são compras (cabeçalhos, totais, boleto, encargos, etc.)
const SKIP = new RegExp([
  "SALDO", "Total d", "Total p", "Pr[óo]xima fatura", "Demais faturas",
  "Limite", "Juros", "IOF", "Multa", "Encargos", "DATA\\s+ESTABELECIMENTO",
  "DATA\\s+PRODUTOS", "DATA\\s+VALOR", "PAGAMENTO", "Pagamento",
  "Lan[çc]amentos", "Repasse", "D[óo]lar de Convers", "FERNANDO",
  "Resumo da fatura", "Titular", "Cart[ãa]o\\b", "Postagem", "Vencimento:",
  "Emiss[ãa]o", "Previs[ãa]o", "recibo do pagador", "Banco Ita[úu]",
  "Nosso N[úu]mero", "Ag[êe]ncia", "Local de Pagamento", "Nome do",
  "Endere[çc]o", "Uso do Banco", "Carteira", "Esp[ée]cie", "Quantidade",
  "Aceite", "Autentica[çc]", "Sacador", "Valor do Documento",
  "Data de Vencimento", "Instru[çc]", "O n[ãa]o pagamento",
  "Preparamos", "Parcelas fixas", "Valor em reais", "Valor total financiado",
  "Total a pagar", "O total da sua fatura", "Com vencimento",
  "Principal \\(", "USD\\b", "BRL\\b",
].join("|"), "i");

/** Fatura Itaú: compras vêm em 2 linhas (dados + categoria/cidade). Lê a 1a, ignora a 2a. */
export function parseItauFatura(text: string): ParseResult {
  const warnings: string[] = [];

  const due = text.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const closing = text.match(/Fechamento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const total = text.match(/Total desta fatura\s+([\d.]+,\d{2})/i);

  const dueISO = due ? brDateToISO(due[1]) : null;
  const dueDate = dueISO ? new Date(dueISO + "T12:00:00") : null;
  const refMonth = dueISO ? dueISO.slice(0, 7) : null;

  const cutIdx = text.search(/Compras?\s+par?cel?adas?\s*-\s*pr[óo]?x/i);
  const body = cutIdx > 0 ? text.slice(0, cutIdx) : text;

  const lines = body.split(/\n/).map((l) => l.trim());
  const txs: ParsedTransaction[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line || SKIP.test(line)) continue;
    const m = line.match(TX);
    if (!m) continue;
    const [, ddmm, descRaw, val] = m;

    const amount = parseBRL(val);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (/\b(USD|BRL)\b/i.test(descRaw)) continue;

    const desc = descRaw.trim();
    let year = dueDate ? dueDate.getFullYear() : new Date().getFullYear();
    const [dd, mm] = ddmm.split("/");
    let iso = `${year}-${mm}-${dd}`;
    if (dueDate && new Date(iso + "T12:00:00") > dueDate) iso = `${year - 1}-${mm}-${dd}`;

    const inst = detectInstallment(desc);
    const cat = suggestCategory(desc);

    const key = `${iso}|${amount}|${desc.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    txs.push({
      transaction_date: iso,
      description_original: desc,
      description_clean: cleanDescription(desc.replace(/\s*\d{1,2}\/\d{1,2}\s*$/, "")),
      amount: -Math.abs(amount),
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
      affects_cash_flow: false,
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
