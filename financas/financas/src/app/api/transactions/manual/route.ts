import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";
import { projectRecurrences } from "@/lib/engine/recurrence";
import { addMonths, format } from "date-fns";

export const runtime = "nodejs";

/**
 * Lançamentos manuais (despesas e receitas) gravados PELO SERVIDOR.
 * POST cria: à vista (com projeção de 3 meses se recorrente) OU parcelado
 * (N lançamentos, 1 por mês — a 1ª com o status escolhido, as demais previstas).
 * PATCH edita; DELETE remove.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as {
    kind: "expense" | "income";
    date: string;
    description: string;
    amount: number;              // à vista = valor total; parcelado = valor de CADA parcela
    category_id: string | null;
    account_id: string | null;
    status: "paid" | "forecast" | "pending";
    recurring: boolean;
    notes: string | null;
    installments?: number | null; // vazio/1 = à vista; >=2 = parcelado
  };

  const value = Math.abs(Number(b.amount));
  if (!b.description?.trim() || !Number.isFinite(value) || value === 0 || !b.date) {
    return NextResponse.json({ error: "Preencha descrição, valor e data." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  }
  const signed = b.kind === "expense" ? -value : value;

  const base = {
    user_id: FAMILY_USER_ID,
    account_id: b.account_id,
    category_id: b.category_id,
    type: b.kind,
    description_original: b.description.trim(),
    description_clean: b.description.trim(),
    source: "manual",
    is_recurring: b.recurring,
    is_card_purchase: false,
    affects_cash_flow: true,          // manual = à vista/parcela recebida: impacta o caixa
    affects_category_report: true,
    notes: b.notes || null,
  };

  // -------- PARCELADO --------
  const n = b.installments && Number(b.installments) >= 2 ? Math.floor(Number(b.installments)) : 1;
  if (n >= 2) {
    if (n > 60) return NextResponse.json({ error: "Número de parcelas muito alto (máximo 60)." }, { status: 400 });
    const primeira = new Date(b.date + "T12:00:00");
    const rows = [];
    for (let i = 0; i < n; i++) {
      const d = i === 0 ? b.date : format(addMonths(primeira, i), "yyyy-MM-dd");
      const isPrimeira = i === 0;
      rows.push({
        ...base,
        amount: signed,
        transaction_date: d,
        // 1ª parcela com o status escolhido; futuras entram como "prevista"
        status: isPrimeira ? b.status : "forecast",
        source: isPrimeira ? "manual" : "installment_forecast",
        is_recurring: false,
        is_installment: true,
        installment_number: i + 1,
        installment_total: n,
        description_original: `${b.description.trim()} (parcela ${i + 1}/${n})`,
      });
    }
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, installments: n });
  }

  // -------- À VISTA (comportamento atual) --------
  const { error: insErr } = await supabase.from("transactions").insert({
    ...base, amount: signed, transaction_date: b.date, status: b.status,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  let projected = 0;
  if (b.recurring) {
    const futures = projectRecurrences({ lastDateISO: b.date, amount: signed, months: 3 });
    const { error: recErr } = await supabase.from("transactions").insert(
      futures.map((f) => ({
        ...base, amount: f.amount, transaction_date: f.transaction_date,
        status: "forecast", source: "recurrence",
        description_original: `${b.description.trim()} (prevista)`,
      }))
    );
    if (!recErr) projected = futures.length;
  }

  return NextResponse.json({ ok: true, projected });
}

/**
 * Edição de um lançamento manual PELO SERVIDOR.
 * Só altera os campos enviados (data, descrição, valor, categoria, conta, status).
 * NUNCA toca em affects_cash_flow / source / tipo de impacto no caixa.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as {
    id: string;
    kind: "expense" | "income";     // define o sinal do valor
    date?: string;
    description?: string;
    amount?: number;                // sempre positivo
    category_id?: string | null;
    account_id?: string | null;
    status?: string;
  };

  if (!b.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const patch: Record<string, unknown> = {};

  if (b.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "Data inválida." }, { status: 400 });
    patch.transaction_date = b.date;
  }
  if (typeof b.description === "string") {
    if (!b.description.trim()) return NextResponse.json({ error: "A descrição não pode ficar vazia." }, { status: 400 });
    patch.description_clean = b.description.trim();
  }
  if (b.amount !== undefined) {
    const value = Math.abs(Number(b.amount));
    if (!Number.isFinite(value) || value === 0) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    patch.amount = b.kind === "expense" ? -value : value;
  }
  if (b.category_id !== undefined) patch.category_id = b.category_id;
  if (b.account_id !== undefined) patch.account_id = b.account_id;
  if (b.status) patch.status = b.status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const { error, data } = await supabase.from("transactions").update(patch).eq("id", b.id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
