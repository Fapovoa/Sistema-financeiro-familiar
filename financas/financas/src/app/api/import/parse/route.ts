import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
// import direto do lib evita bug do pdf-parse que tenta ler arquivo de teste
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse/lib/pdf-parse.js");
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";
import { parsePdfText } from "@/lib/parsers";
import { parseItauFaturaXlsx } from "@/lib/parsers/itau-fatura-xlsx";
import { evaluateDuplicate, ExistingTx } from "@/lib/engine/dedupe";
import { suggestCategory } from "@/lib/engine/categorize";
import { normalizeDescription } from "@/lib/parsers/normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/parse
 * FormData: file (PDF ou XLSX), document_type, account_id, reference_month
 * PDF  -> pdf-parse + parsePdfText (detecção por instituição)
 * XLSX -> parseItauFaturaXlsx (fatura do Itaú exportada do app)
 * Nada é gravado aqui: devolve a prévia.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = { id: FAMILY_USER_ID }; // autenticação desativada

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const documentType = String(form.get("document_type") ?? "");
  const accountId = String(form.get("account_id") ?? "");
  if (!file) return NextResponse.json({ error: "Envie um arquivo PDF ou XLSX." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buf).digest("hex");

  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, import_status, file_name")
    .eq("file_hash", fileHash)
    .maybeSingle();

  // Detecta o tipo de arquivo: XLSX (Excel) ou PDF
  const isXlsx = /\.xlsx$/i.test(file.name)
    || file.type.includes("spreadsheetml")
    || file.type.includes("excel");

  let result;
  if (isXlsx) {
    try {
      result = parseItauFaturaXlsx(buf);
    } catch {
      return NextResponse.json({ error: "Não foi possível ler o arquivo XLSX." }, { status: 422 });
    }
  } else {
    let text = "";
    try {
      const parsed = await pdf(buf);
      text = parsed.text ?? "";
    } catch {
      return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
    }
    result = parsePdfText(text);
  }

  // Regras de categorização aprendidas do usuário (camada 1)
  const { data: rules } = await supabase
    .from("categorization_rules")
    .select("normalized_pattern, category_id, confidence");

  const { data: renames } = await supabase
    .from("rename_rules")
    .select("normalized_pattern, new_name");

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, type");
  const catByName = new Map((categories ?? []).map((c) => [c.name.toLowerCase() + ":" + c.type, c.id]));

  const dates = result.transactions.map((t) => t.transaction_date).sort();
  let existing: ExistingTx[] = [];
  if (dates.length) {
    const { data } = await supabase
      .from("transactions")
      .select("id, transaction_date, amount, description_clean, status, source, is_installment, installment_number")
      .gte("transaction_date", dates[0])
      .lte("transaction_date", dates[dates.length - 1]);
    existing = (data as ExistingTx[]) ?? [];
  }

  const preview = result.transactions.map((t) => {
    let description_clean = t.description_clean;
    const norm = normalizeDescription(t.description_original);
    for (const r of renames ?? []) {
      if (!r.normalized_pattern) continue;
      if (norm.includes(r.normalized_pattern) || r.normalized_pattern.includes(norm)) {
        description_clean = r.new_name;
        break;
      }
    }
    const ruled = suggestCategory(t.description_original, (rules ?? []) as never);
    let category_id: string | null = null;
    let category_name = t.category_suggestion;
    let confidence = t.confidence_score;
    if (ruled.category_id) {
      category_id = ruled.category_id;
      confidence = ruled.confidence;
      category_name = (categories ?? []).find((c) => c.id === ruled.category_id)?.name ?? category_name;
    } else if (t.category_suggestion) {
      const key = t.category_suggestion.toLowerCase() + ":" + (t.type === "income" ? "income" : "expense");
      category_id = catByName.get(key) ?? null;
    }

    const dup = evaluateDuplicate(
      { dateISO: t.transaction_date, amount: t.amount, desc: t.description_clean, installment_number: t.installment_number },
      existing
    );
    const deduplication_status = t.deduplication_status === "reconcile" ? "reconcile" : dup.status;
    const suggested_action =
      deduplication_status === "possible_duplicate" ? "ignore"
      : deduplication_status === "reconcile" ? "reconcile"
      : confidence < 0.5 && t.type === "expense" ? "audit"
      : t.suggested_action;

    return { ...t, description_clean, category_id, category_suggestion: category_name, confidence_score: confidence, deduplication_status, duplicate_match_id: dup.matchId, suggested_action };
  });

  return NextResponse.json({
    already_imported: existingDoc?.import_status === "imported" ? existingDoc : null,
    file_hash: fileHash,
    file_name: file.name,
    document_type: documentType || result.detected_type,
    account_id: accountId || null,
    detected: {
      type: result.detected_type,
      institution: result.detected_institution,
      invoice: result.invoice ?? null,
    },
    warnings: result.warnings,
    transactions: preview,
    summary: {
      found: preview.length,
      new: preview.filter((t) => t.deduplication_status === "new").length,
      duplicates: preview.filter((t) => t.deduplication_status === "possible_duplicate").length,
      reconcile: preview.filter((t) => t.deduplication_status === "reconcile").length,
      audit: preview.filter((t) => t.suggested_action === "audit").length,
    },
  });
}
