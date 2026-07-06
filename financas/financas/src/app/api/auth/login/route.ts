import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Login por palavra-chave (a mesma cadastrada na página Perfil).
 * Valida PELO SERVIDOR e grava um cookie de acesso (o "crachá").
 * Proteção leve para uso familiar — não substitui autenticação completa.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { keyword } = await req.json() as { keyword: string };

  if (!keyword?.trim()) {
    return NextResponse.json({ error: "Digite a palavra-chave." }, { status: 400 });
  }

  const { data, error } = await supabase.from("profile").select("keyword").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sem palavra-chave cadastrada: deixa entrar (evita você se trancar fora)
  // e avisa para cadastrar uma na página Perfil.
  const cadastrada = data?.keyword?.trim();
  if (cadastrada) {
    const ok = cadastrada.toLowerCase() === keyword.trim().toLowerCase();
    if (!ok) return NextResponse.json({ error: "Palavra-chave incorreta." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, warning: cadastrada ? null : "Nenhuma palavra-chave cadastrada — defina uma na página Perfil." });
  res.cookies.set("fp_auth", "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 180, // 180 dias sem pedir de novo neste navegador
  });
  return res;
}
