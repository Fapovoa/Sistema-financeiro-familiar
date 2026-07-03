import { ParsedTransaction, ParseResult } from "./types";
import { brDateToISO, cleanDescription, detectInstallment, parseBRL } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";

// A extração do PDF pode vir SEM espaços entre as colunas:
//   "28/05IVAN SOUZA     11/12164,63"   (data + estabelecimento + parcela + valor)
//   "03/03ARMAZEM BOM PASTORJUIZ23,80"  (data + estabelecimento + valor)
// Ou com espaços (visualizadores diferentes). Os padrões abaixo cobrem os dois casos.
const AMOUNT = "(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2})";
const TX_INSTALLMENT = new RegExp(`^(\\d{2}\\/\\d{2})\\s*(.+?)\\s(\\d{2}\\/\\d{2})\\s*${AMOUNT}\\s*$`);
const TX_SIMPLE = new RegExp(`^(\\d{2}\\/\\d{2})\\s*(.+?)\\s*${AMOUNT}\\s*$`);

// Linhas que NÃO são compras (cabeçalhos, totais, boleto, encargos, etc.)
const SKIP = new RegExp([
  "SALDO", "Total d", "Total p", "Pr[óo]xima fatura", "Demais faturas",
  "Limite", "Juros", "IOF", "Multa", "Encargos", "ESTABELECIMENTO",
  "PRODUTOS/SERVI", "PAGAMENTO", "Pagamento", "Lan[çc]amentos", "Repasse",
  "D[óo]lar de Convers", "Resumo da fatura", "Titular", "Postagem",
  "Vencimento", "Emiss[ãa]o", "Previs[ãa]o", "recibo do pagador",
  "Banco Ita[úu]", "Nosso N[úu]mero", "Ag[êe]ncia", "Local de Pagamento",
  "Nome do", "Endere[çc]o", "Uso do Banco", "Carteira", "Esp[ée]cie",
  "Quantidade", "Aceite", "Autentica[çc]", "Sacador", "Valor do Documento",
  "Data de Vencimento", "Instru[çc]", "O n[ãa]o pagamento", "Preparamos",
  "Parcelas fixas", "Valor em reais", "Valor total financiado",
  "Total a pagar", "O total da sua fatura", "Com vencimento",
  "Principal \\(", "\\bUSD\\b", "\\bBRL\\b", "Fique atento", "Simula[çc]",
].join("|"), "i");

/** Fatura Itaú — robusto a texto com ou sem espaços entre colunas. */
export function parseItauFatura(text: string): ParseResult {
  const warnings: string[] = [];

  const due = text.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const closing = text.match(/Fechamento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const total = text.match(/Total desta fatura\s*([\d.]+,\d{2})/i);

  const dueISO = due ? brDateToISO(due[1]) : null;
  const dueDate = dueISO ? new Date(dueISO + "T12:00:00") : null;
  const refMonth = dueISO ? dueISO.slice(0, 7) : null;

  // Corta a seção "Compras parceladas - próximas faturas" (previsões, não desta fatura)
  const cutIdx = text.search(/Compras?\s*par?cel?adas?\s*-\s*pr[óo]?x/i);
  const body = cutIdx > 0 ? text.slice(0, cutIdx) : text;

  const lines = body.split(/\n/).map((l) => l.trim());
  const txs: ParsedTransaction[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line || SKIP.test(line)) continue;

    // 1º tenta o padrão com parcela (NN/NN colado no valor); depois o simples
    let ddmm = "", desc = "", val = "";
    const mi = line.match(TX_INSTALLMENT);
    if (mi) {
      ddmm = mi[1]; desc = `${mi[2].trim()} ${mi[3]}`; val = mi[4];
    } else {
      const ms = line.match(TX_SIMPLE);
      if (!ms) continue;
      ddmm = ms[1]; desc = ms[2].trim(); val = ms[3];
    }

    const amount = parseBRL(val);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (desc.length < 3) continue;

    // Ano: compras podem ser do ano anterior ao vencimento (parcelas antigas, dez/jan)
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
