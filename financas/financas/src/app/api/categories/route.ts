import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";

export const runtime = "nodejs";

const NATURES = ["fixed", "variable", "undefined"];

/** CRUD de categorias PELO SERVIDOR (imune a bloqueios do navegador). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as { name: string; type: "expense" | "income"; color: string | null; nature?: string };
  if (!b.name?.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });

  // Natureza só se aplica a despesas; receitas ficam sempre "undefined".
  const nature = b.type === "expense" && NATURES.includes(b.nature ?? "") ? b.nature : "undefined";

  const { error } = await supabase.from("categories").insert({
    user_id: FAMILY_USER_ID, name: b.name.trim(), type: b.type, color: b.color, nature,
  });
  if (error) {
    const msg = error.message.includes("duplicate") ? "Já existe uma categoria com esse nome." : error.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as { id: string; name?: string; color?: string | null; nature?: string };
  if (!b.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string") {
    if (!b.name.trim()) return NextResponse.json({ error: "O nome não pode ficar vazio." }, { status: 400 });
    patch.name = b.name.trim();
  }
  if (b.color !== undefined) patch.color = b.color;
  if (b.nature !== undefined) {
    if (!NATURES.includes(b.nature)) return NextResponse.json({ error: "Natureza inválida." }, { status: 400 });
    patch.nature = b.nature;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });

  const { error, data } = await supabase.from("categories").update(patch).eq("id", b.id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
