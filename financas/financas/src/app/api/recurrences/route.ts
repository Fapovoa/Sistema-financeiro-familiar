import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";
import { txHash } from "@/lib/engine/dedupe";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";

export const runtime = "nodejs";

type RulePayload = {
  id?: string;
  kind: "expense" | "income";
  description: string;
  amount: number;              // sempre positivo; o sinal vem do kind
  category_id: string | null;
  account_id: string | null;
  day_of_month: number;
  start_date: string;          // yyyy-MM-dd
  end_date: string | null;     // yyyy-MM-dd ou null = sem fim
  months_ahead: number;
  active: boolean;
  notes: string | null;
};

/**
 * Datas que a recorrência deve gerar.
 * - Começa na DATA DE INÍCIO da recorrência (inclui meses passados = retroativo).
 * - Com data de FIM: projeta até ela (teto de segurança de 60 meses à frente).
 * - Sem fim: projeta "months_ahead" meses à frente de hoje.
 * Retorna cada data com um sinalizador "retroativa" (anterior a hoje).
 */
function datesForRule(r: RulePayload, todayISO: string): { iso: string; retroativa: boolean }[] {
  const out: { iso: string; retroativa: boolean }[] = [];
  const today = new Date(todayISO + "T12:00:00");
  const startBase = new Date(r.start_date + "T12:00:00");
  const end = r.end_date ? new Date(r.end_date + "T12:00:00") : null;

  const tetoSeguranca = addMonths(today, 60);
  let horizon: Date;
  if (end) {
    horizon = end <= tetoSeguranca ? end : tetoSeguranca;
  } else {
    horizon = addMonths(today, Math.max(1, Math.min(24, r.months_ahead || 3)));
  }

  // Cursor começa no mês da DATA DE INÍCIO (não em hoje) → gera o passado também
  let cursor = startOfMonth(startBase);
  while (cursor <= horizon) {
    const lastDay = endOfMonth(cursor).getDate();
    const day = Math.min(Math.max(1, r.day_of_month), lastDay); // dia 31 vira 28/29/30 quando o mês não tem
    const d = new Date(cursor.getFullYear(), cursor.getMonth(), day, 12);
    if (d >= startBase && (!end || d <= end) && d <= horizon) {
      out.push({ iso: format(d, "yyyy-MM-dd"), retroativa: d < today });
    }
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/**
 * Apaga as previsões desta recorrência que ainda podem ser regeradas.
 * Remove tanto as futuras quanto as retroativas em status "forecast"
 * (nunca mexe no que já foi marcado como pago/confirmado pelo usuário).
 */
async function clearRegenerableForecasts(supabase: Awaited<ReturnType<typeof createClient>>, ruleId: string) {
  await supabase.from("transactions")
    .delete()
    .eq("recurrence_id", ruleId)
    .eq("status", "forecast")
    .eq("source", "recurrence");
}

/** Gera as previsões da recorrência (status=forecast), incluindo as retroativas. */
async function generateForecasts(supabase: Awaited<ReturnType<typeof createClient>>, ruleId: string, r: RulePayload, todayISO: string) {
  const signed = r.kind === "expense" ? -Math.abs(r.amount) : Math.abs(r.amount);
  const datas = datesForRule(r, todayISO);
  let created = 0;
  let retroativas = 0;
  for (const { iso, retroativa } of datas) {
    const hash = txHash(FAMILY_USER_ID, iso, signed, r.description + " recorrencia " + ruleId);
    const { data: dup } = await supabase.from("transactions").select("id").eq("duplicate_hash", hash).maybeSingle();
    if (dup) continue;
    const { error } = await supabase.from("transactions").insert({
      user_id: FAMILY_USER_ID,
      account_id: r.account_id,
      category_id: r.category_id,
      recurrence_id: ruleId,
      type: r.kind,
      description_original: retroativa ? `${r.description} (prevista retroativa)` : `${r.description} (prevista)`,
      description_clean: r.description,
      amount: signed,
      transaction_date: iso,
      // Retroativas e futuras entram como "forecast": aparecem, mas NÃO mexem
      // no caixa realizado. O usuário marca como paga (✓) quando quiser.
      status: "forecast",
      source: "recurrence",
      is_recurring: true,
      is_card_purchase: false,
      affects_cash_flow: true,
      affects_category_report: true,
      duplicate_hash: hash,
      notes: r.notes,
    });
    if (!error) { created++; if (retroativa) retroativas++; }
  }
  return { created, retroativas };
}

function validate(b: RulePayload): string | null {
  if (!b.description?.trim()) return "Informe a descrição.";
  const v = Math.abs(Number(b.amount));
  if (!Number.isFinite(v) || v === 0) return "Informe um valor válido.";
  if (!b.day_of_month || b.day_of_month < 1 || b.day_of_month > 31) return "Dia do mês deve ser entre 1 e 31.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) return "Informe a data de início.";
  if (b.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.end_date)) return "Data de fim inválida.";
  if (b.end_date && b.end_date < b.start_date) return "A data de fim não pode ser anterior à de início.";
  return null;
}

/** Cria a recorrência e já gera as previsões (incluindo retroativas). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as RulePayload;
  const err = validate(b);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const todayISO = format(new Date(), "yyyy-MM-dd");
  const { data: rule, error: insErr } = await supabase.from("recurrences").insert({
    user_id: FAMILY_USER_ID,
    kind: b.kind,
    description: b.description.trim(),
    amount: Math.abs(Number(b.amount)),
    category_id: b.category_id,
    account_id: b.account_id,
    day_of_month: b.day_of_month,
    start_date: b.start_date,
    end_date: b.end_date,
    months_ahead: b.months_ahead || 3,
    active: b.active !== false,
    notes: b.notes,
  }).select("id").single();
  if (insErr || !rule) return NextResponse.json({ error: insErr?.message ?? "Falha ao criar." }, { status: 500 });

  let created = 0, retroativas = 0;
  if (b.active !== false) {
    const g = await generateForecasts(supabase, rule.id, b, todayISO);
    created = g.created; retroativas = g.retroativas;
  }
  return NextResponse.json({ ok: true, id: rule.id, forecasts: created, retroativas });
}

/** Atualiza a recorrência e REGERA as previsões (apaga as antigas em forecast e recria). */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as RulePayload;
  if (!b.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const err = validate(b);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const todayISO = format(new Date(), "yyyy-MM-dd");
  const { error: upErr, data } = await supabase.from("recurrences").update({
    kind: b.kind,
    description: b.description.trim(),
    amount: Math.abs(Number(b.amount)),
    category_id: b.category_id,
    account_id: b.account_id,
    day_of_month: b.day_of_month,
    start_date: b.start_date,
    end_date: b.end_date,
    months_ahead: b.months_ahead || 3,
    active: b.active,
    notes: b.notes,
    updated_at: new Date().toISOString(),
  }).eq("id", b.id).select("id");
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Recorrência não encontrada." }, { status: 404 });

  await clearRegenerableForecasts(supabase, b.id);
  let created = 0, retroativas = 0;
  if (b.active) {
    const g = await generateForecasts(supabase, b.id, b, todayISO);
    created = g.created; retroativas = g.retroativas;
  }
  return NextResponse.json({ ok: true, forecasts: created, retroativas });
}

/** Exclui a recorrência e apaga as previsões dela (o que já foi pago fica). */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  await clearRegenerableForecasts(supabase, id);
  const { error } = await supabase.from("recurrences").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
