"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { Save } from "lucide-react";
import clsx from "clsx";

/**
 * Perfil: nome do perfil + palavra-chave.
 * Leitura client-side; gravação pelo servidor (/api/profile).
 */
export default function PerfilPage() {
  const supabase = createClient();
  const [profileName, setProfileName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("profile").select("profile_name, keyword").maybeSingle();
    setProfileName(data?.profile_name ?? "");
    setKeyword(data?.keyword ?? "");
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_name: profileName, keyword }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: "Perfil salvo." });
  }

  return (
    <>
      <Header title="Perfil" />
      <div className="space-y-5 p-6">
        {msg && (
          <p className={clsx("rounded-xl px-4 py-3 text-sm", msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
            {msg.text}
          </p>
        )}

        <form onSubmit={save} className="card max-w-xl space-y-4 p-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Nome do perfil</span>
            <input
              className="input"
              placeholder="Ex.: Família Póvoa"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              disabled={loading}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Palavra-chave</span>
            <input
              className="input"
              placeholder="Sua palavra-chave"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              disabled={loading}
            />
          </label>

          <div className="pt-1">
            <button className="btn-primary" disabled={saving || loading}>
              <Save size={16} /> {saving ? "Salvando…" : "Salvar perfil"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
