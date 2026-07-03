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
 * Grava definitivamente a prévia confirmada pelo usuário:
 *  - documento + storage já enviados pelo cliente (file_path)
 *  - fatura de cartão (upsert por competência) + lançamento consolidado no vencimento
 *  - lançamentos individuais (cartão: affects_cash_flow=false)
 *  - projeção de parcelas futuras (status=forecast) nas faturas futuras
 *  - reconciliação: pagamento de fatura no extrato marca a fatura como paga
 *  - itens de baixa confiança viram audit_items
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

  let imported = 0, ignored = 0, audits = 0, reconciled = 0;

  for (const t of transactions) {
    if (t.action === "ignore") { ignored++; continue; }

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
          duplicate_hash: txHash(user.id, t.transaction_date, t.amount, t.description_original),
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
      continue;
    }

    // Grupo de parcelamento
    let groupId: string | null = null;
    if (t.is_installment && t.installment_total) {
      const base = normalizeDescription(t.description_clean);
      const { data: g } = await supabase
        .from("installment_groups")
        .select("id")
        .eq("description_base", base)
        .eq("total_installments", t.installment_total)
        .maybeSingle();
      if (g) groupId = g.id;
      else {
        const { data: ng } = await supabase
          .from("installment_groups")
          .insert({
            user_id: user.id, account_id,
            description_base: base,
            merchant_name: t.description_clean,
            total_installments: t.installment_total,
            first_installment_date: t.transaction_date,
            amount_per_installment: Math.abs(t.amount),
            total_amount: Math.abs(t.amount) * t.installment_total,
          })
          .select("id").single();
        groupId = ng?.id ?? null;
      }
    }

    const hash = txHash(user.id, t.transaction_date, t.amount, t.description_original);

    // Se existe forecast compatível, confirma em vez de inserir
    if (t.deduplication_status === "reconcile" && t.duplicate_match_id) {
      await supabase.from("transactions").update({
        status: "confirmed",
        transaction_date: t.transaction_date,
        amount: t.amount,
        description_original: t.description_original,
        document_id: doc.id,
        duplicate_hash: hash,
      }).eq("id", t.duplicate_match_id);
      reconciled++;
      continue;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        account_id,
        category_id: t.category_id,
        document_id: doc.id,
        invoice_id: t.is_card_purchase ? invoiceId : null,
        installment_group_id: groupId,
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
    if (insErr || !inserted) continue;
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

    // Projeção de parcelas futuras (forecast dentro das faturas futuras)
    if (t.is_installment && t.installment_number && t.installment_total && t.invoice_reference_month && groupId) {
      const futures = projectFutureInstallments({
        currentNumber: t.installment_number,
        totalInstallments: t.installment_total,
        amount: t.amount,
        purchaseDateISO: t.transaction_date,
        invoiceRefMonth: t.invoice_reference_month,
      });
      for (const f of futures) {
        const fHash = txHash(user.id, f.transaction_date, f.amount, t.description_clean + " parc " + f.installment_number);
        const { data: dupF } = await supabase
          .from("transactions").select("id").eq("duplicate_hash", fHash).maybeSingle();
        if (dupF) continue;
        await supabase.from("transactions").insert({
          user_id: user.id,
          account_id,
          category_id: t.category_id,
          installment_group_id: groupId,
          type: "expense",
          description_original: `${t.description_clean} — parcela ${f.installment_number}/${t.installment_total} (prevista)`,
          description_clean: t.description_clean,
          amount: f.amount,
          transaction_date: f.transaction_date,
          competence_month: f.invoice_reference_month + "-01",
          status: "forecast",
          source: "installment_forecast",
          is_installment: true,
          installment_number: f.installment_number,
          installment_total: t.installment_total,
          is_card_purchase: true,
          affects_cash_flow: false,
          affects_category_report: true,
          duplicate_hash: fHash,
        });
      }
    }
  }

  await supabase.from("import_batches").insert({
    user_id: user.id,
    document_id: doc.id,
    status: "done",
    total_transactions_found: transactions.length,
    total_imported: imported,
    total_duplicates: ignored,
    total_audit: audits,
  });

  return NextResponse.json({ ok: true, imported, ignored, audits, reconciled, document_id: doc.id });
}
