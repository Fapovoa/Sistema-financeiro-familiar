import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";

export const runtime = "nodejs";

type Payload = {
  id?: string;
  name: string; type: string; institution: string | null;
  last_four_digits: string | null;
  closing_day: number | null; due_day: number | null; credit_limit: number | null;
};

/** CRUD de contas/cartões PELO SERVIDOR (imune a bloqueios do navegador). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as Payload;
  if (!b.name?.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
  const { error } = await supabase.from("accounts").insert({
    user_id: FAMILY_USER_ID, name: b.name.trim(), type: b.type, institution: b.institution,
    last_four_digits: b.last_four_digits, closing_day: b.closing_day,
    due_day: b.due_day, credit_limit: b.credit_limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as Payload;
  if (!b.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const { error, data } = await supabase.from("accounts").update({
    name: b.name.trim(), type: b.type, institution: b.institution,
    last_four_digits: b.last_four_digits, closing_day: b.closing_day,
    due_day: b.due_day, credit_limit: b.credit_limit,
  }).eq("id", b.id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
