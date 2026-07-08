import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";
import { txHash } from "@/lib/engine/dedupe";
import { projectFutureInstallments } from "@/lib/engine/installments";
import { normalizeDescription } from "@/lib/parsers/normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

type IncomingTx = {
  transaction_date: string;
  description_original: string;
  description_clean: string;
  amount: number;
  type: string;
  category_id: string | null;
  confidence_score: number;
  is_installment: boolean;
  installment_number: number | null;
  installment_total: number | null;
  is_recurring_candidate: boolean;
  is_card_purchase: boolean;
  learn_rename?: boolean;
  invoice_reference_month?: string | null;
  invoice_due_date?: string | null;
  affects_cash_flow: boolean;
  affects_category_report: boolean;
  deduplication_status: string;
  duplicate_match_id?: string | null;
  action: "import" | "ignore" | "audit" | "reconcile";
};

/**
 * POST /api/import/confirm
 * Grava definitivamente a prévia confirmada pelo usuário. A lógica de gravação é
 * idêntica à anterior; a diferença é que os lançamentos são processados em LOTES
 * PARALELOS (em vez de um a um em fila), para responder em segundos e não estourar
 * o tempo limite da função (o que fazia a mensagem de sucesso nunca aparecer).
 *
 * Observação: linhas de PARCELAMENTO são processadas em série (fora do paralelo),
 * porque compartilham "grupos de parcela" e não podem competir entre si.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = { id: FAMILY_USER_ID }; // autenticação desativada

  const body = await req.json();
  const {
    file_hash, file_name, file_path, document_type, account_id,
    institution, invoice, transactions,
  } = body as {
    file_hash: string; file_name: string; file_path: string | null;
    document_type: "bank_statement" | "credit_card_statement";
    account_id: string; institution: string | null;
    invoice: { total_amount: number | null; due_date: string | null; closing_date: string | null; reference_month: string | null } | null;
    transactions: IncomingTx[];
  };

  // 1. documento
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .upsert(
      {
        user_id: user.id,
        account_id,
        file_name,
        file_url: file_path,
        document_type,
        institution,
        reference_month: invoice?.reference_month ? invoice.reference_month + "-01" : null,
        file_hash,
        import_status: "imported",
      },
      { onConflict: "user_id,file_hash" }
    )
    .select("id")
    .single();
  if (docErr || !doc) return NextResponse.json({ error: docErr?.message }, { status: 500 });

  // 2. fatura (se documento é fatura de cartão)
  let invoiceId: string | null = null;
  if (document_type === "credit_card_statement" && invoice?.reference_month && invoice.due_date) {
    const { data: inv } = await supabase
      .from("credit_card_invoices")
      .upsert(
        {
          user_id: user.id,
          account_id,
          document_id: doc.id,
          reference_month: invoice.reference_month + "-01",
          closing_date: invoice.closing_date,
          due_date: invoice.due_date,
          total_amount: invoice.total_amount ?? 0,
          status: "closed",
        },
        { onConflict: "user_id,account_id,reference_month" }
      )
      .select("id, cash_flow_transaction_id")
      .single();
    invoiceId = inv?.id ?? null;

    // lançamento consolidado da fatura no vencimento (impacta o caixa)
    if (invoiceId && invoice.total_amount && !inv?.cash_flow_transaction_id) {
      const { data: cft } = await supabase
        .from("transactions")
        .insert({
          user_id: user.id,
          account_id,
          document_id: doc.id,
          invoice_id: invoiceId,
          type: "expense",
          description_original: `Fatura ${institution ?? "cartão"} — ${invoice.reference_month}`,
          description_clean: `Fatura ${institution ?? "Cartão"}`,
          amount: -Math.abs(invoice.total_amount),
          transaction_date: invoice.due_date,
          due_date: invoice.due_date,
          competence_month: invoice.reference_month + "-01",
          status: "pending",
          source: "invoice_total",
          is_card_purchase: false,
          affects_cash_flow: true,          // ÚNICO impacto da fatura no caixa
          affects_category_report: false,   // evita dupla contagem analítica
          duplicate_hash: txHash(user.id, invoice.due_date, -Math.abs(invoice.total_amount), "fatura " + (institution ?? "")),
        })
        .select("id")
        .single();
      if (cft) {
        await supabase.from("credit_card_invoices").update({ cash_flow_transaction_id: cft.id }).eq("id", invoiceId);
      }
    }
  }

  let imported = 0, ignored = 0, audits = 0, reconciled = 0, skipped = 0;

  // IDEMPOTÊNCIA: evita duplicar ao reimportar/reconfirmar o mesmo arquivo.
  // Buscamos, de uma vez, quais "impressões digitais" (hash) já existem no banco.
  const incomingHashes = transactions.map((t) =>
    txHash(user.id, t.transaction_date, t.amount, t.description_original)
  );
  const existing = new Set<string>();
  for (let i = 0; i < incomingHashes.length; i += 300) {
    const slice = incomingHashes.slice(i, i + 300);
    const { data } = await supabase
      .from("transactions")
      .select("duplicate_hash")
      .in("duplicate_hash", slice);
    for (const r of data ?? []) if (r?.duplicate_hash) existing.add(r.duplicate_hash);
  }
  const seen = new Set<string>(); // evita duplicar dentro do próprio lote

  // Processa UMA linha da prévia (mesma lógica de antes). Retorna nada; ajusta contadores.
  async function processRow(t: IncomingTx) {
    if (t.action === "ignore") { ignored++; return; }

    // Forecast já existente: confirma o previsto (update), não insere.
    if (t.deduplication_status === "reconcile" && t.duplicate_match_id) {
      const h0 = txHash(user.id, t.transaction_date, t.amount, t.description_original);
      await supabase.from("transactions").update({
        status: "confirmed",
        transaction_date: t.transaction_date,
        amount: t.amount,
        description_original: t.description_original,
        document_id: doc.id,
        duplicate_hash: h0,
      }).eq("id", t.duplicate_match_id);
      reconciled++;
      return;
    }

    // Guarda de idempotência (síncrona, antes de qualquer await): se já existe, pula.
    const hash = txHash(user.id, t.transaction_date, t.amount, t.description_original);
    if (existing.has(hash) || seen.has(hash)) { skipped++; return; }
    seen.add(hash);

    // Usuário renomeou na prévia: aprende a regra para as próximas importações
    if (t.learn_rename && t.description_clean?.trim()) {
      const np = normalizeDescription(t.description_original);
      if (np.length >= 3) {
        await supabase.from("rename_rules").upsert({
          user_id: user.id,
          pattern: t.description_original,
          normalized_pattern: np,
          new_name: t.description_clean.trim(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,normalized_pattern" });
      }
    }

    // Reconciliação: pagamento de fatura no extrato -> marca fatura paga, não duplica despesa
    if (t.action === "reconcile" || t.type === "credit_card_payment") {
      const { data: openInv } = await supabase
        .from("credit_card_invoices")
        .select("id, total_amount")
        .in("status", ["open", "closed", "overdue", "pending"])
        .eq("total_amount", Math.abs(t.amount))
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: payTx } = await supabase
        .from("transactions")
        .insert({
          user_id: user.id, account_id, document_id: doc.id,
          invoice_id: openInv?.id ?? null,
          type: "credit_card_payment",
          description_original: t.description_original,
          description_clean: t.description_clean,
          amount: t.amount,
          transaction_date: t.transaction_date,
          status: "paid", source: "pdf_import",
          affects_cash_flow: !openInv,      // se reconciliou, a fatura já representa o caixa
          affects_category_report: false,
          duplicate_hash: hash,
        })
        .select("id").single();

      if (openInv && payTx) {
        await supabase.from("credit_card_invoices")
          .update({ status: "paid", payment_transaction_id: payTx.id })
          .eq("id", openInv.id);
        // lançamento consolidado da fatura passa a "paid"
        await supabase.from("transactions")
          .update({ status: "paid", payment_date: t.transaction_date })
          .eq("invoice_id", openInv.id).eq("source", "invoice_total");
        reconciled++;
      }
      return;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        account_id,
        category_id: t.category_id,
        document_id: doc.id,
        invoice_id: t.is_card_purchase ? invoiceId : null,
        installment_group_id: null,
        type: t.type,
        description_original: t.description_original,
        description_clean: t.description_clean,
        amount: t.amount,
        transaction_date: t.transaction_date,
        due_date: t.invoice_due_date ?? null,
        competence_month: t.invoice_reference_month ? t.invoice_reference_month + "-01" : null,
        status: "paid",
        source: "pdf_import",
        is_recurring: false,
        is_installment: t.is_installment,
        installment_number: t.installment_number,
        installment_total: t.installment_total,
        is_card_purchase: t.is_card_purchase,
        affects_cash_flow: t.is_card_purchase ? false : t.affects_cash_flow,
        affects_category_report: t.affects_category_report,
        duplicate_hash: hash,
        confidence_score: t.confidence_score,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return;
    imported++;

    // Auditoria para baixa confiança
    if (t.action === "audit" || (t.confidence_score < 0.5 && t.type === "expense")) {
      await supabase.from("audit_items").insert({
        user_id: user.id,
        transaction_id: inserted.id,
        reason: t.category_id ? "Baixa confiança na categorização" : "Sem categoria identificada",
        suggested_category_id: t.category_id,
        confidence_score: t.confidence_score,
      });
      audits++;
    }
  }

  // Processa UMA linha de PARCELAMENTO (mantida em série: grupos de parcela são compartilhados).
  async function processInstallmentRow(t: IncomingTx) {
    if (t.action === "ignore") { ignored++; return; }

    const hash = txHash(user.id, t.transaction_date, t.amount, t.description_original);
    if (existing.has(hash) || seen.has(hash)) { skipped++; return; }
    seen.add(hash);

    if (t.learn_rename && t.description_clean?.trim()) {
      const np = normalizeDescription(t.description_original);
      if (np.length >= 3) {
        await supabase.from("rename_rules").upsert({
          user_id: user.id, pattern: t.description_original, normalized_pattern: np,
          new_name: t.description_clean.trim(), updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,normalized_pattern" });
      }
    }

    let groupId: string | null = null;
    if (t.installment_total) {
      const base = normalizeDescription(t.description_clean);
      const { data: g } = await supabase
        .from("installment_groups").select("id")
        .eq("description_base", base).eq("total_installments", t.installment_total).maybeSingle();
      if (g) groupId = g.id;
      else {
        const { data: ng } = await supabase
          .from("installment_groups")
          .insert({
            user_id: user.id, account_id, description_base: base,
            merchant_name: t.description_clean, total_installments: t.installment_total,
            first_installment_date: t.transaction_date, amount_per_installment: Math.abs(t.amount),
            total_amount: Math.abs(t.amount) * t.installment_total,
          })
          .select("id").single();
        groupId = ng?.id ?? null;
      }
    }

    const { data: inserted, error: insErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id, account_id, category_id: t.category_id, document_id: doc.id,
        invoice_id: t.is_card_purchase ? invoiceId : null, installment_group_id: groupId,
        type: t.type, description_original: t.description_original, description_clean: t.description_clean,
        amount: t.amount, transaction_date: t.transaction_date, due_date: t.invoice_due_date ?? null,
        competence_month: t.invoice_reference_month ? t.invoice_reference_month + "-01" : null,
        status: "paid", source: "pdf_import", is_recurring: false,
        is_installment: t.is_installment, installment_number: t.installment_number,
        installment_total: t.installment_total, is_card_purchase: t.is_card_purchase,
        affects_cash_flow: t.is_card_purchase ? false : t.affects_cash_flow,
        affects_category_report: t.affects_category_report, duplicate_hash: hash,
        confidence_score: t.confidence_score,
      })
      .select("id").single();
    if (insErr || !inserted) return;
    imported++;

    if (t.action === "audit" || (t.confidence_score < 0.5 && t.type === "expense")) {
      await supabase.from("audit_items").insert({
        user_id: user.id, transaction_id: inserted.id,
        reason: t.category_id ? "Baixa confiança na categorização" : "Sem categoria identificada",
        suggested_category_id: t.category_id, confidence_score: t.confidence_score,
      });
      audits++;
    }

    if (t.installment_number && t.installment_total && t.invoice_reference_month && groupId) {
      const futures = projectFutureInstallments({
        currentNumber: t.installment_number, totalInstallments: t.installment_total,
        amount: t.amount, purchaseDateISO: t.transaction_date, invoiceRefMonth: t.invoice_reference_month,
      });
      for (const f of futures) {
        const fHash = txHash(user.id, f.transaction_date, f.amount, t.description_clean + " parc " + f.installment_number);
        const { data: dupF } = await supabase.from("transactions").select("id").eq("duplicate_hash", fHash).maybeSingle();
        if (dupF) continue;
        await supabase.from("transactions").insert({
          user_id: user.id, account_id, category_id: t.category_id, installment_group_id: groupId,
          type: "expense",
          description_original: `${t.description_clean} — parcela ${f.installment_number}/${t.installment_total} (prevista)`,
          description_clean: t.description_clean, amount: f.amount, transaction_date: f.transaction_date,
          competence_month: f.invoice_reference_month + "-01", status: "forecast", source: "installment_forecast",
          is_installment: true, installment_number: f.installment_number, installment_total: t.installment_total,
          is_card_purchase: true, affects_cash_flow: false, affects_category_report: true, duplicate_hash: fHash,
        });
      }
    }
  }

  // Parcelamentos em série (poucos e compartilham grupo); o resto em lotes paralelos.
  const installmentRows = transactions.filter((t) => t.is_installment && t.installment_total);
  const normalRows = transactions.filter((t) => !(t.is_installment && t.installment_total));

  for (const t of installmentRows) await processInstallmentRow(t);

  const CHUNK = 15;
  for (let i = 0; i < normalRows.length; i += CHUNK) {
    await Promise.all(normalRows.slice(i, i + CHUNK).map((t) => processRow(t)));
  }

  await supabase.from("import_batches").insert({
    user_id: user.id,
    document_id: doc.id,
    status: "done",
    total_transactions_found: transactions.length,
    total_imported: imported,
    total_duplicates: ignored + skipped,
    total_audit: audits,
  });

  // "skipped" = lançamentos que já existiam (reimport/reconfirm) e foram evitados.
  return NextResponse.json({ ok: true, imported, ignored: ignored + skipped, audits, reconciled, skipped, document_id: doc.id });
}
