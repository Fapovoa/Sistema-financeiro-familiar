import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";
import { projectRecurrences } from "@/lib/engine/recurrence";

export const runtime = "nodejs";

/**
 * Lançamentos manuais (despesas e receitas) gravados PELO SERVIDOR.
 * POST cria (com projeção de 3 meses se recorrente); DELETE remove.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as {
    kind: "expense" | "income";
    date: string;
    description: string;
    amount: number;              // sempre positivo; o sinal é definido pelo kind
    category_id: string | null;
    account_id: string | null;
    status: "paid" | "forecast" | "pending";
    recurring: boolean;
    notes: string | null;
  };

  const value = Math.abs(Number(b.amount));
  if (!b.description?.trim() || !Number.isFinite(value) || value === 0 || !b.date) {
    return NextResponse.json({ error: "Preencha descrição, valor e data." }, { status: 400 });
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
    affects_cash_flow: true,          // manual = à vista: impacta o caixa (Caju incluso)
    affects_category_report: true,
    notes: b.notes || null,
  };

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

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
