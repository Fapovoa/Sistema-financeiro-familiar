import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FAMILY_USER_ID } from "@/lib/user";

export const runtime = "nodejs";

/**
 * Perfil (nome do perfil + palavra-chave) — gravação PELO SERVIDOR.
 * Uma única linha por usuário (upsert por user_id).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const b = await req.json() as { profile_name: string | null; keyword: string | null };

  const { error } = await supabase.from("profile").upsert({
    user_id: FAMILY_USER_ID,
    profile_name: b.profile_name?.trim() || null,
    keyword: b.keyword?.trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
