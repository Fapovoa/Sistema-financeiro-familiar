/** Converte "1.234,56" / "-1.234,56" em número JS. */
export function parseBRL(raw: string): number {
  const clean = raw.replace(/[R$\s\u2212]/g, (c) => (c === "\u2212" ? "-" : "")).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : NaN;
}

/** dd/mm/yyyy -> yyyy-mm-dd */
export function brDateToISO(d: string): string {
  const [dd, mm, yyyy] = d.split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

const MONTHS_PT: Record<string, string> = {
  jan: "01", janeiro: "01", fev: "02", fevereiro: "02", mar: "03", marco: "03",
  abr: "04", abril: "04", mai: "05", maio: "05", jun: "06", junho: "06",
  jul: "07", julho: "07", ago: "08", agosto: "08", set: "09", setembro: "09",
  out: "10", outubro: "10", nov: "11", novembro: "11", dez: "12", dezembro: "12",
};
export function monthPtToNum(name: string): string | null {
  const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return MONTHS_PT[key] ?? null;
}

/** Normaliza descrição para matching/hash. */
export function normalizeDescription(desc: string): string {
  return desc
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, " ")
    .replace(/parc(ela)?\s*\d+\s*(de|\/)\s*\d+/g, " ")
    .replace(/\b\d+\/\d+\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Descrição amigável. */
export function cleanDescription(desc: string): string {
  const base = desc
    .replace(/^PIX (QRS|TRANSF|AUT)\s*/i, "")
    .replace(/^(Pix (enviado|recebido): )?"?Cp :\d+-?/i, "")
    .replace(/"+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return base
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Detecta parcelamento: "LOJA X 03/12", "Parcela 5/12", "PARC 01/10". */
export function detectInstallment(desc: string): { current: number; total: number } | null {
  const m =
    desc.match(/parcela\s*(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})/i) ||
    desc.match(/\bparc\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i) ||
    desc.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
  if (!m) return null;
  const current = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (current >= 1 && total >= 2 && total <= 48 && current <= total) {
    return { current, total };
  }
  return null;
}
