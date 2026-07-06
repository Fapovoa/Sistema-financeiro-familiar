import { ParsedTransaction, ParseResult } from "./types";
import { cleanDescription } from "./normalize";
import { suggestCategory, isRecurringCandidate } from "@/lib/engine/categorize";
import { inflateRawSync } from "zlib";

/**
 * Parser da FATURA DO ITAÚ em formato .xlsx (exportado do app/site do Itaú).
 * Lê o Excel SEM biblioteca externa: um .xlsx é um ZIP com XML; o Node
 * descompacta nativamente (zlib.inflateRawSync). Muito mais confiável que o
 * PDF "grudado", pois as colunas já vêm separadas.
 *
 * Regras (validadas contra 7 faturas reais, soma batendo com o Itaú):
 *  - "Pagamento Com Saldo" (pagamento da fatura anterior) é IGNORADO.
 *  - Compras (valor > 0) viram despesa (amount negativo).
 *  - Estornos/créditos (valor < 0) viram refund (amount positivo).
 *  - Parcelamento vem na coluna "Parcela N de M".
 *  - Compra de cartão: affects_cash_flow=false, affects_category_report=true.
 *    O caixa é impactado só pelo consolidado da fatura no vencimento (no confirm).
 */

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

type Cell = string | { num: number } | null;

/** Descompacta o .xlsx (ZIP) lendo o Central Directory — só Node nativo. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Arquivo .xlsx inválido (EOCD não encontrado).");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    try {
      files[name] = method === 0 ? comp : inflateRawSync(comp);
    } catch { /* ignora entrada corrompida */ }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const reSi = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = reSi.exec(xml))) {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
    out.push(unescapeXml(parts.join("")));
  }
  return out;
}

function colToIndex(ref: string): number {
  const m = ref.match(/^([A-Z]+)/);
  let col = 0;
  for (const ch of m![1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col - 1;
}

function parseSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  const reRow = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let mr: RegExpExecArray | null;
  while ((mr = reRow.exec(xml))) {
    const cells: Cell[] = [];
    const reC = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let mc: RegExpExecArray | null;
    while ((mc = reC.exec(mr[1]))) {
      const attrs = mc[1];
      const inner = mc[2] || "";
      const refM = attrs.match(/r="([A-Z]+\d+)"/);
      const idx = refM ? colToIndex(refM[1]) : cells.length;
      const typeM = attrs.match(/t="([^"]+)"/);
      const type = typeM ? typeM[1] : "n";
      const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
      const isM = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let val: Cell = null;
      if (type === "s" && vM) val = shared[parseInt(vM[1], 10)] ?? null;
      else if (type === "inlineStr" && isM) val = unescapeXml(isM[1]);
      else if (vM) val = { num: parseFloat(vM[1]) };
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

/** Serial de data do Excel -> ISO yyyy-MM-dd. */
function excelSerialToISO(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

const asText = (c: Cell): string => (typeof c === "string" ? c : "");
const asNum = (c: Cell): number | null => (c && typeof c === "object" ? c.num : null);

export function parseItauFaturaXlsx(buf: Buffer): ParseResult {
  const warnings: string[] = [];
  let rows: Cell[][];
  try {
    const files = unzip(buf);
    const shared = parseSharedStrings(files["xl/sharedStrings.xml"]?.toString("utf8"));
    const sheetKey = Object.keys(files).find((k) => /xl\/worksheets\/sheet1\.xml$/.test(k))
      ?? Object.keys(files).find((k) => /xl\/worksheets\/.*\.xml$/.test(k));
    if (!sheetKey) throw new Error("planilha não encontrada");
    rows = parseSheet(files[sheetKey].toString("utf8"), shared);
  } catch {
    return {
      detected_type: "credit_card_statement",
      detected_institution: null,
      transactions: [],
      warnings: ["Não foi possível ler o arquivo .xlsx. Confirme que é a fatura exportada do Itaú."],
    };
  }

  let refMonth: string | null = null;
  let dueISO: string | null = null;
  let totalHeader: number | null = null;
  let isItau = false;

  for (const row of rows.slice(0, 14)) {
    for (const c of row) {
      const t = asText(c);
      if (/Ita[úu]/i.test(t)) isItau = true;
      const mt = t.match(/Fatura\s+(?:Paga|Fechada)\s*-\s*([A-Za-zÀ-ÿ]+)\/(\d{4})/i);
      if (mt) {
        const mes = MESES[mt[1].toLowerCase()];
        if (mes) refMonth = `${mt[2]}-${String(mes).padStart(2, "0")}`;
      }
    }
    const nums = row.map(asNum).filter((n): n is number => n != null);
    const datas = row.filter((c) => c && typeof c === "object" && (c as { num: number }).num > 40000)
      .map((c) => (c as { num: number }).num);
    if (nums.length && refMonth) {
      const totalCand = nums.find((n) => n > 40000) != null ? nums.filter((n) => n < 40000)[0] : nums[nums.length - 1];
      if (totalCand != null && totalHeader == null) totalHeader = totalCand;
      const serialVenc = datas[0];
      if (serialVenc && !dueISO) dueISO = excelSerialToISO(serialVenc);
    }
  }

  if (!isItau) warnings.push("Arquivo não parece uma fatura do Itaú — revise a prévia com atenção.");

  let hstart = -1;
  for (let i = 0; i < rows.length; i++) {
    if (asText(rows[i][1]) === "Data") { hstart = i + 1; break; }
  }
  if (hstart < 0) {
    warnings.push("Não encontrei a lista de lançamentos na planilha do Itaú. [parser xlsx v1]");
    return {
      detected_type: "credit_card_statement",
      detected_institution: "Itaú XLSX (v1)",
      invoice: { total_amount: totalHeader, due_date: dueISO, closing_date: null, reference_month: refMonth },
      transactions: [],
      warnings,
    };
  }

  const txs: ParsedTransaction[] = [];
  let subtotalPlanilha: number | null = null;
  let somaLancamentos = 0;

  for (let i = hstart; i < rows.length; i++) {
    const r = rows[i];
    const desc = asText(r[2]).trim();
    const valCell = asNum(r[4]);

    const joined = r.map(asText).join(" ").toLowerCase();
    if (joined.includes("subtotal")) {
      const nums = r.map(asNum).filter((n): n is number => n != null);
      if (nums.length) subtotalPlanilha = nums[nums.length - 1];
      continue;
    }
    if (!desc || valCell == null) continue;
    if (/pagamento com saldo/i.test(desc)) continue;

    somaLancamentos += valCell;

    const dCell = r[1];
    const iso = (dCell && typeof dCell === "object")
      ? excelSerialToISO(dCell.num)
      : String(dCell ?? "").slice(0, 10);

    const parcTxt = asText(r[3]);
    const pm = parcTxt.match(/Parcela\s+(\d+)\s+de\s+(\d+)/i);
    const instNum = pm ? parseInt(pm[1], 10) : null;
    const instTot = pm ? parseInt(pm[2], 10) : null;

    const isEstorno = valCell < 0;
    const amount = isEstorno ? Math.abs(valCell) : -Math.abs(valCell);
    const cat = suggestCategory(desc);

    txs.push({
      transaction_date: iso,
      description_original: desc,
      description_clean: cleanDescription(desc),
      amount,
      type: isEstorno ? "refund" : "expense",
      category_suggestion: cat.category,
      confidence_score: cat.confidence,
      is_installment: !!pm,
      installment_number: instNum,
      installment_total: instTot,
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

  const totalFatura = subtotalPlanilha ?? Number(somaLancamentos.toFixed(2));

  if (!dueISO) warnings.push("Não identifiquei a data de vencimento na planilha.");
  if (txs.length === 0) warnings.push("Nenhum lançamento reconhecido na fatura Itaú (xlsx). [parser xlsx v1]");

  return {
    detected_type: "credit_card_statement",
    detected_institution: "Itaú XLSX (v1)",
    invoice: {
      total_amount: totalFatura,
      due_date: dueISO,
      closing_date: null,
      reference_month: refMonth,
    },
    transactions: txs,
    warnings,
  };
}
