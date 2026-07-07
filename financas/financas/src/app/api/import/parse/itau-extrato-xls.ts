// ============================================================
// Parser: Extrato de Conta Corrente Itaú exportado em Excel (.xls legado / BIFF)
// Finanças Póvoa — src/lib/parsers/itau-extrato-xls.ts
//
// POR QUE ESTE ARQUIVO EXISTE:
// O Itaú exporta o "Extrato Conta Corrente" como .xls BINÁRIO ANTIGO (BIFF/OLE),
// e o conteúdo é um EXTRATO (conta corrente), não uma FATURA de cartão.
// O parser de fatura (parseItauFaturaXlsx) não entende esse layout e falha.
// Este parser lê o extrato via SheetJS (que abre .xls e .xlsx) e devolve
// no MESMO formato ParseResult usado por todos os outros parsers.
//
// Layout da aba "Lançamentos":
//   linhas de topo : metadados (Atualização, Nome, Agência, Conta)
//   cabeçalho      : ["data","lançamento","ag./origem","valor (R$)","saldos (R$)"]
//   "SALDO ANTERIOR"            -> saldo de abertura (NÃO é lançamento)
//   "SALDO TOTAL DISPONÍVEL DIA"-> saldo do dia (NÃO é lançamento)
//   demais linhas  : lançamentos reais (valor negativo = saída)
// ============================================================
import * as XLSX from "xlsx";
import { ParseResult, ParsedTransaction } from "./types";

// "31/12/2025" -> "2025-12-31"
function toISO(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// número robusto: aceita -60, -60.00, "-1.234,56" (BR) ou "1234.56" (US)
function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/R\$\s*/i, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// remove o sufixo de data que o Itaú gruda no nome ("Roberto01/01", "AUGUSTO 05/01")
function cleanDesc(raw: string): string {
  return String(raw)
    .replace(/\s+/g, " ")
    .replace(/\s*\d{2}\/\d{2}\s*$/, "")
    .replace(/(\S)\d{2}\/\d{2}\s*$/, "$1")
    .trim();
}

const RE_SALDO_ANTERIOR = /SALDO\s+ANTERIOR/i;
const RE_SALDO_DIA = /SALDO\s+TOTAL\s+DISPON/i;       // ignora acento/mojibake (DISPONÍVEL/DISPONÃVEL)
const RE_FATURA_PAGA = /FATURA\s+PAGA|PAGAMENTO\s+FATURA|PAG\s+FATURA/i;
const RE_RENDIMENTO = /REND\s+PAGO|RENDIMENTO/i;
const RE_APLIC = /APLIC\s*AUT|APLICA[ÇC][ÃA]O\s+AUT|RESGATE/i;

function readWorkbook(buffer: ArrayBuffer | Buffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer", codepage: 1252 });
}

// Detector: usado pela rota para diferenciar extrato de fatura.
export function isItauExtratoXls(buffer: ArrayBuffer | Buffer | Uint8Array): boolean {
  try {
    const wb = readWorkbook(buffer);
    const name = wb.SheetNames.find((n) => /Lan[çc]amentos/i.test(n));
    if (!name) return false;
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: false, defval: null });
    const top = rows.slice(0, 12).map((r) => (r || []).join("|")).join("\n");
    return /Ag[êe]ncia|Conta:|valor \(R\$\)/i.test(top);
  } catch {
    return false;
  }
}

export function parseItauExtratoXls(buffer: ArrayBuffer | Buffer | Uint8Array): ParseResult {
  const warnings: string[] = [];
  const wb = readWorkbook(buffer);
  const sheetName = wb.SheetNames.find((n) => /Lan[çc]amentos/i.test(n));
  if (!sheetName) {
    return { detected_type: "bank_statement", detected_institution: null, transactions: [],
      warnings: ["Aba 'Lançamentos' não encontrada — não parece um extrato de conta Itaú."] };
  }

  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });

  // localizar o cabeçalho "data | lançamento | ..."
  let headerIdx = rows.findIndex(
    (r) => String(r?.[0] ?? "").trim().toLowerCase() === "data" &&
           /lan[çc]amento/i.test(String(r?.[1] ?? ""))
  );
  if (headerIdx === -1) { headerIdx = 8; warnings.push("Cabeçalho não localizado; usando posição padrão."); }

  const transactions: ParsedTransaction[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const dateISO = toISO(String(r[0] ?? ""));
    const desc = String(r[1] ?? "").trim();
    if (!dateISO || !desc) continue;
    if (desc.toLowerCase() === "lançamentos") continue;
    if (RE_SALDO_ANTERIOR.test(desc) || RE_SALDO_DIA.test(desc)) continue; // marcadores de saldo

    const val = parseNum(r[3]);
    if (val === null) continue; // linha sem valor não é lançamento

    // Classificação
    let type: ParsedTransaction["type"];
    let category_suggestion: string | null = null;
    let affects_cash_flow = true;
    let affects_category_report = true;
    let deduplication_status: ParsedTransaction["deduplication_status"] = "new";
    let suggested_action: ParsedTransaction["suggested_action"] = "import";

    if (RE_FATURA_PAGA.test(desc)) {
      // Pagamento de fatura de cartão: reconciliar com a fatura registrada (não duplicar despesa)
      type = "credit_card_payment";
      affects_cash_flow = false;
      affects_category_report = false;
      deduplication_status = "reconcile";
      suggested_action = "reconcile";
    } else if (RE_RENDIMENTO.test(desc)) {
      type = "income";
      category_suggestion = "Rendimentos";
    } else if (RE_APLIC.test(desc)) {
      // aplicação automática / resgate: transferência interna, não é despesa/receita
      type = "transfer";
      affects_cash_flow = false;
      affects_category_report = false;
    } else if (val < 0) {
      type = "expense";
    } else {
      type = "income";
    }

    transactions.push({
      transaction_date: dateISO,
      description_original: desc,
      description_clean: cleanDesc(desc),
      amount: val,                       // negativo = saída (padrão do sistema)
      type,
      category_suggestion,
      confidence_score: 0,               // deixa a categorização por regras/auditoria decidir
      is_installment: false,             // extrato de conta não tem parcelas
      installment_number: null,
      installment_total: null,
      is_recurring_candidate: false,
      is_card_purchase: false,
      affects_cash_flow,
      affects_category_report,
      deduplication_status,
      suggested_action,
    });
  }

  if (transactions.length === 0)
    warnings.push("Nenhum lançamento extraído — confirme que é o extrato de conta corrente.");

  return {
    detected_type: "bank_statement",
    detected_institution: "Itaú",
    transactions,
    warnings,
  };
}
