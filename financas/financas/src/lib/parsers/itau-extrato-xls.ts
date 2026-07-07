// ============================================================================
// Parser: Extrato de Conta Corrente Itaú em Excel .xls LEGADO (binário/BIFF8).
// Finanças Póvoa — src/lib/parsers/itau-extrato-xls.ts
//
// POR QUE ESTE ARQUIVO É "GRANDE":
// O Itaú exporta o "Extrato Conta Corrente" como .xls BINÁRIO ANTIGO (OLE2/BIFF8),
// que NÃO é um ZIP — então o truque do itau-fatura-xlsx.ts (descompactar como .xlsx)
// não serve. Aqui vai um leitor mínimo de OLE2+BIFF8, ZERO dependências (só Buffer
// nativo do Node), no mesmo espírito. Testado célula-a-célula contra um extrato real.
//
// Devolve no MESMO formato ParseResult usado por todos os outros parsers.
// ============================================================================
import { ParseResult, ParsedTransaction } from "./types";

/* ============================ Leitor OLE2 + BIFF8 ============================ */
type Cell = string | number | null;

function readCFBStreams(buf: Buffer): { name: string; type: number; data: Buffer }[] {
  if (buf.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1") throw new Error("Não é OLE2/.xls");
  const secSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const firstDir = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const firstMiniFat = buf.readUInt32LE(60);
  const firstDifat = buf.readUInt32LE(68);
  const nDifat = buf.readUInt32LE(72);
  const secOff = (id: number) => (id + 1) * secSize;

  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) { const v = buf.readUInt32LE(76 + i * 4); if (v === 0xffffffff) break; fatSectors.push(v); }
  let ds = firstDifat;
  for (let k = 0; k < nDifat && ds !== 0xffffffff && ds !== 0xfffffffe; k++) {
    const base = secOff(ds); const perSec = secSize / 4 - 1;
    for (let i = 0; i < perSec; i++) { const v = buf.readUInt32LE(base + i * 4); if (v !== 0xffffffff) fatSectors.push(v); }
    ds = buf.readUInt32LE(base + perSec * 4);
  }
  const fat: number[] = [];
  for (const fs of fatSectors) { const base = secOff(fs); for (let i = 0; i < secSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4)); }
  const chain = (start: number, arr: number[]) => { const out: number[] = []; let s = start, g = 0; while (s !== 0xfffffffe && s !== 0xffffffff && g++ < 1e7) { out.push(s); s = arr[s]; } return out; };
  const readFat = (start: number) => Buffer.concat(chain(start, fat).map((s) => buf.subarray(secOff(s), secOff(s) + secSize)));

  const dirBuf = readFat(firstDir);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dirBuf.length; o += 128) {
    const nameLen = dirBuf.readUInt16LE(o + 64); if (nameLen <= 0) continue;
    entries.push({
      name: dirBuf.toString("utf16le", o, o + Math.max(0, nameLen - 2)),
      type: dirBuf.readUInt8(o + 66), start: dirBuf.readUInt32LE(o + 116), size: dirBuf.readUInt32LE(o + 120),
    });
  }
  const root = entries.find((e) => e.type === 5);
  const miniStream = root ? readFat(root.start) : Buffer.alloc(0);
  const miniFat: number[] = [];
  if (firstMiniFat !== 0xffffffff && firstMiniFat !== 0xfffffffe) { const mf = readFat(firstMiniFat); for (let i = 0; i < mf.length / 4; i++) miniFat.push(mf.readUInt32LE(i * 4)); }
  const readMini = (start: number, size: number) => Buffer.concat(chain(start, miniFat).map((s) => miniStream.subarray(s * miniSize, s * miniSize + miniSize))).subarray(0, size);

  return entries.filter((e) => e.type === 2).map((e) => ({ name: e.name, type: e.type, data: e.size < miniCutoff ? readMini(e.start, e.size) : readFat(e.start).subarray(0, e.size) }));
}

function rkToNum(rk: number): number {
  const div100 = (rk & 1) !== 0, isInt = (rk & 2) !== 0; let n: number;
  if (isInt) n = rk >> 2; else { const b = Buffer.alloc(8); b.writeUInt32LE(rk & 0xfffffffc, 4); n = b.readDoubleLE(0); }
  return div100 ? n / 100 : n;
}
function readSST(records: { type: number; data: Buffer }[], sstIdx: number): string[] {
  const strings: string[] = [];
  const parts: Buffer[] = [records[sstIdx].data]; const bounds: number[] = [records[sstIdx].data.length];
  for (let i = sstIdx + 1; i < records.length; i++) { if (records[i].type !== 0x003c) break; parts.push(records[i].data); bounds.push(bounds[bounds.length - 1] + records[i].data.length); }
  const data = Buffer.concat(parts); const isBoundary = (p: number) => bounds.includes(p);
  let p = 8; const nUnique = records[sstIdx].data.readUInt32LE(4);
  for (let s = 0; s < nUnique && p < data.length; s++) {
    const cch = data.readUInt16LE(p); p += 2; let flags = data.readUInt8(p); p += 1; let rich = 0, ext = 0;
    if (flags & 0x08) { rich = data.readUInt16LE(p); p += 2; }
    if (flags & 0x04) { ext = data.readUInt32LE(p); p += 4; }
    let chars = "", read = 0;
    while (read < cch) {
      if (isBoundary(p) && read > 0) { flags = data.readUInt8(p); p += 1; }
      const wide = (flags & 0x01) !== 0; let nextB = data.length;
      for (const b of bounds) if (b > p) { nextB = b; break; }
      const charsAvail = wide ? Math.floor((nextB - p) / 2) : nextB - p;
      const take = Math.min(cch - read, charsAvail);
      if (wide) { chars += data.toString("utf16le", p, p + take * 2); p += take * 2; } else { chars += data.toString("latin1", p, p + take); p += take; }
      read += take; if (take === 0) break;
    }
    strings.push(chars); p += rich * 4 + ext;
  }
  return strings;
}
function parseXlsBiff(buf: Buffer): { name: string; rows: Cell[][] }[] {
  const wbStream = readCFBStreams(buf).find((s) => /^(Workbook|Book)$/i.test(s.name));
  if (!wbStream) throw new Error("Stream 'Workbook' não encontrado no .xls");
  const wb = wbStream.data;
  const records: { type: number; data: Buffer; pos: number }[] = [];
  let o = 0;
  while (o + 4 <= wb.length) { const type = wb.readUInt16LE(o); const len = wb.readUInt16LE(o + 2); records.push({ type, data: wb.subarray(o + 4, o + 4 + len), pos: o }); o += 4 + len; }
  const sstIdx = records.findIndex((r) => r.type === 0x00fc);
  const sst = sstIdx >= 0 ? readSST(records, sstIdx) : [];
  const boundsheets: { name: string; bofPos: number }[] = [];
  for (const r of records) if (r.type === 0x0085) {
    const cch = r.data.readUInt8(6); const wide = (r.data.readUInt8(7) & 0x01) !== 0;
    boundsheets.push({ bofPos: r.data.readUInt32LE(0), name: wide ? r.data.toString("utf16le", 8, 8 + cch * 2) : r.data.toString("latin1", 8, 8 + cch) });
  }
  const sheets: { name: string; rows: Cell[][] }[] = [];
  for (const bs of boundsheets) {
    const startIdx = records.findIndex((r) => r.pos === bs.bofPos && r.type === 0x0809);
    if (startIdx < 0) { sheets.push({ name: bs.name, rows: [] }); continue; }
    const cells: Cell[][] = [];
    const put = (row: number, col: number, val: Cell) => { while (cells.length <= row) cells.push([]); const r = cells[row]; while (r.length <= col) r.push(null); r[col] = val; };
    for (let i = startIdx + 1; i < records.length; i++) {
      const r = records[i]; if (r.type === 0x000a || r.type === 0x0809) break; const d = r.data;
      if (r.type === 0x00fd) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? null);
      else if (r.type === 0x0203) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
      else if (r.type === 0x027e) put(d.readUInt16LE(0), d.readUInt16LE(2), rkToNum(d.readUInt32LE(6)));
      else if (r.type === 0x00bd) { const row = d.readUInt16LE(0), cf = d.readUInt16LE(2), n = (d.length - 6) / 6; for (let k = 0; k < n; k++) put(row, cf + k, rkToNum(d.readUInt32LE(6 + k * 6 + 2))); }
      else if (r.type === 0x0204) { const cch = d.readUInt16LE(6); const wide = (d.readUInt8(8) & 0x01) !== 0; put(d.readUInt16LE(0), d.readUInt16LE(2), wide ? d.toString("utf16le", 9, 9 + cch * 2) : d.toString("latin1", 9, 9 + cch)); }
      else if (r.type === 0x0006) { if (d.readUInt16LE(12) !== 0xffff) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6)); }
    }
    sheets.push({ name: bs.name, rows: cells });
  }
  return sheets;
}

/* ============================== Parser do extrato ============================== */
function toISO(br: string): string | null { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br).trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; }
function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/R\$\s*/i, ""); if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function cleanDesc(raw: string): string {
  return String(raw).replace(/\s+/g, " ").replace(/\s*\d{2}\/\d{2}\s*$/, "").replace(/(\S)\d{2}\/\d{2}\s*$/, "$1").trim();
}
const RE_SALDO_ANT = /SALDO\s+ANTERIOR/i;
const RE_SALDO_DIA = /SALDO\s+TOTAL\s+DISPON/i;          // ignora acento/mojibake
const RE_FATURA = /FATURA\s+PAGA|PAGAMENTO\s+FATURA|PAG\s+FATURA/i;
const RE_REND = /REND\s+PAGO|RENDIMENTO/i;
const RE_APLIC = /APLIC\s*AUT|APLICA[ÇC][ÃA]O\s+AUT|RESGATE/i;

function getLancamentos(buf: Buffer): Cell[][] | null {
  const sheets = parseXlsBiff(buf);
  const s = sheets.find((x) => /Lan[çc]amentos/i.test(x.name));
  return s ? s.rows : null;
}

// Detector usado pela rota para diferenciar extrato (.xls) de fatura (.xlsx).
export function isItauExtratoXls(buffer: Buffer): boolean {
  try {
    const rows = getLancamentos(buffer);
    if (!rows) return false;
    const top = rows.slice(0, 12).map((r) => (r || []).map((c) => String(c ?? "")).join("|")).join("\n");
    return /Ag[êe]ncia|Conta:|valor \(R\$\)/i.test(top);
  } catch { return false; }
}

export function parseItauExtratoXls(buffer: Buffer): ParseResult {
  const warnings: string[] = [];
  let rows: Cell[][] | null;
  try { rows = getLancamentos(buffer); }
  catch { return { detected_type: "bank_statement", detected_institution: null, transactions: [], warnings: ["Não foi possível ler o .xls do extrato Itaú."] }; }
  if (!rows) return { detected_type: "bank_statement", detected_institution: null, transactions: [], warnings: ["Aba 'Lançamentos' não encontrada — não parece o extrato de conta Itaú."] };

  let headerIdx = rows.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase() === "data" && /lan[çc]amento/i.test(String(r?.[1] ?? "")));
  if (headerIdx === -1) { headerIdx = 8; warnings.push("Cabeçalho não localizado; usando posição padrão."); }

  const transactions: ParsedTransaction[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const dateISO = toISO(String(r[0] ?? "")); const desc = String(r[1] ?? "").trim();
    if (!dateISO || !desc || desc.toLowerCase() === "lançamentos") continue;
    if (RE_SALDO_ANT.test(desc) || RE_SALDO_DIA.test(desc)) continue;
    const val = parseNum(r[3]); if (val === null) continue;

    let type: ParsedTransaction["type"]; let category_suggestion: string | null = null;
    let affects_cash_flow = true, affects_category_report = true;
    let deduplication_status: ParsedTransaction["deduplication_status"] = "new";
    let suggested_action: ParsedTransaction["suggested_action"] = "import";

    if (RE_FATURA.test(desc)) { type = "credit_card_payment"; affects_cash_flow = false; affects_category_report = false; deduplication_status = "reconcile"; suggested_action = "reconcile"; }
    else if (RE_REND.test(desc)) { type = "income"; category_suggestion = "Rendimentos"; }
    else if (RE_APLIC.test(desc)) { type = "transfer"; affects_cash_flow = false; affects_category_report = false; }
    else if (val < 0) type = "expense";
    else type = "income";

    transactions.push({
      transaction_date: dateISO, description_original: desc, description_clean: cleanDesc(desc),
      amount: val, type, category_suggestion, confidence_score: 0,
      is_installment: false, installment_number: null, installment_total: null,
      is_recurring_candidate: false, is_card_purchase: false,
      affects_cash_flow, affects_category_report, deduplication_status, suggested_action,
    });
  }
  if (transactions.length === 0) warnings.push("Nenhum lançamento extraído — confirme que é o extrato de conta corrente.");
  return { detected_type: "bank_statement", detected_institution: "Itaú", transactions, warnings };
}
