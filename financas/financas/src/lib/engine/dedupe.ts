import { createHash } from "crypto";
import { normalizeDescription } from "@/lib/parsers/normalize";

/** Hash determinístico do lançamento (mesma fórmula do SQL find_possible_duplicates). */
export function duplicateHash(userId: string, dateISO: string, amount: number, desc: string): string {
  return createHash("md5")
    .update(userId + dateISO + amount.toFixed(2).replace(/\.?0+$/, (m) => (m === ".00" ? ".00" : m)) )
    .update(normalizeDescription(desc))
    .digest("hex");
}

/** Hash simples usado no insert (user|date|amount|desc normalizada). */
export function txHash(userId: string, dateISO: string, amount: number, desc: string): string {
  return createHash("md5")
    .update(`${userId}|${dateISO}|${amount.toFixed(2)}|${normalizeDescription(desc)}`)
    .digest("hex");
}

/** Similaridade Jaccard por tokens — barata e suficiente para prévia. */
export function textSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeDescription(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeDescription(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => tb.has(t) && inter++);
  return inter / (ta.size + tb.size - inter);
}

export type ExistingTx = {
  id: string;
  transaction_date: string;
  amount: number;
  description_clean: string | null;
  status: string;
  source: string;
  is_installment: boolean;
  installment_number: number | null;
};

/**
 * Decide o status de deduplicação de um candidato contra lançamentos existentes:
 * - exato (hash) -> possible_duplicate (ação: ignore)
 * - mesmo valor ±4 dias + similaridade alta -> possible_duplicate
 * - existe "forecast" compatível -> reconcile (confirma o previsto, não duplica)
 */
export function evaluateDuplicate(
  candidate: { dateISO: string; amount: number; desc: string; installment_number?: number | null },
  existing: ExistingTx[]
): { status: "new" | "possible_duplicate" | "reconcile"; matchId: string | null } {
  const cDate = new Date(candidate.dateISO + "T12:00:00").getTime();
  const DAY = 86_400_000;

  for (const e of existing) {
    if (Math.abs(e.amount - candidate.amount) > 0.009) continue;
    const eDate = new Date(e.transaction_date + "T12:00:00").getTime();
    if (Math.abs(eDate - cDate) > 6 * DAY) continue;

    const sim = textSimilarity(e.description_clean ?? "", candidate.desc);
    if (sim < 0.45) continue;

    if (e.status === "forecast") return { status: "reconcile", matchId: e.id };
    if (
      candidate.installment_number != null &&
      e.installment_number != null &&
      candidate.installment_number !== e.installment_number
    ) continue; // parcelas diferentes do mesmo grupo não são duplicatas
    return { status: "possible_duplicate", matchId: e.id };
  }
  return { status: "new", matchId: null };
}
