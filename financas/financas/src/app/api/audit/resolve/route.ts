
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";
import { normalizeDescription } from "@/lib/parsers/normalize";

export const runtime = "nodejs";

/**
 * Resolve um item de auditoria PELO SERVIDOR (evita bloqueios do navegador
 * a gravações diretas no Supabase — "Failed to fetch").
 * Ações: classificar (com propagação a todos os idênticos + regras) ou ignorar.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as {
    action: "resolve" | "ignore";
    audit_id: string;
    transaction_id: string;
    category_id: string | null;
    type: string;
    recurring: boolean;
    learn: boolean;
    new_name: string | null;
    old_name: string;
    description_original: string;
  };

  if (b.action === "ignore") {
    const { error: e1 } = await supabase.from("transactions")
      .update({ status: "ignored", type: "ignored" }).eq("id", b.transaction_id);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    const { error: e2 } = await supabase.from("audit_items")
      .update({ status: "ignored", resolved_at: new Date().toISOString() }).eq("id", b.audit_id);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    return NextResponse.json({ ok: true, applied: 1 });
  }

  const newName = (b.new_name ?? b.old_name)?.trim() || b.old_name;

  // 1. atualiza o lançamento do item
  const { error: upErr, data: upData } = await supabase.from("transactions").update({
    category_id: b.category_id,
    type: b.type as never,
    is_recurring: b.recurring,
    description_clean: newName,
    confidence_score: 1,
  }).eq("id", b.transaction_id).select("id");
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (!upData?.length) return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });

  // 2. regras de aprendizado
  if (b.learn) {
    const np = normalizeDescription(b.description_original || b.old_name);
    if (np.length >= 3 && b.category_id) {
      await supabase.from("categorization_rules").upsert({
        user_id: FAMILY_USER_ID,
        pattern: b.old_name,
        normalized_pattern: np,
        category_id: b.category_id,
        confidence: 1,
        created_from_transaction_id: b.transaction_id,
      }, { onConflict: "user_id,normalized_pattern" });
    }
    if (np.length >= 3 && newName !== b.old_name) {
      await supabase.from("rename_rules").upsert({
        user_id: FAMILY_USER_ID,
        pattern: b.description_original || b.old_name,
        normalized_pattern: np,
        new_name: newName,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,normalized_pattern" });
    }
  }

  // 3. propaga para TODOS os idênticos (passados e parcelas futuras já criadas)
  let applied = 1;
  const propagate: Record<string, unknown> = {};
  if (b.category_id) propagate.category_id = b.category_id;
  if (newName !== b.old_name) propagate.description_clean = newName;
  if (Object.keys(propagate).length && b.old_name) {
    const { data: siblings } = await supabase.from("transactions")
      .select("id").eq("description_clean", b.old_name).neq("id", b.transaction_id);
    const ids = (siblings ?? []).map((x) => x.id);
    if (ids.length) {
      const { error: propErr } = await supabase.from("transactions").update(propagate).in("id", ids);
      if (propErr) return NextResponse.json({ error: "Propagação: " + propErr.message }, { status: 500 });
      applied += ids.length;
      await supabase.from("audit_items")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .in("transaction_id", ids).eq("status", "pending");
    }
  }

  // 4. resolve o item
  const { error: resErr } = await supabase.from("audit_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", b.audit_id);
  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, applied });
}
