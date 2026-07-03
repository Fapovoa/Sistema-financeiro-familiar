"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { FAMILY_USER_ID } from "@/lib/user";
import { Plus, Trash2, Check, Pencil, X } from "lucide-react";

type Cat = { id: string; name: string; type: "expense" | "income"; color: string | null };

export default function CategoriasPage() {
  const supabase = createClient();
  const [cats, setCats] = useState<Cat[]>([]);
  const [novo, setNovo] = useState<{ [k in "expense" | "income"]: { name: string; color: string } }>({
    expense: { name: "", color: "#4A6CF7" },
    income: { name: "", color: "#16A34A" },
  });
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("categories").select("id, name, type, color").order("name");
    setCats((data as Cat[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add(type: "expense" | "income") {
    const { name, color } = novo[type];
    if (!name.trim()) return;
    const { error } = await supabase.from("categories").insert({ user_id: FAMILY_USER_ID, name: name.trim(), type, color });
    if (error) return setMsg(error.message.includes("duplicate") ? "Já existe uma categoria com esse nome." : error.message);
    setNovo((n) => ({ ...n, [type]: { ...n[type], name: "" } })); setMsg(null); load();
  }

  async function saveEdit() {
    if (!editing) return;
    const { error } = await supabase.from("categories").update({ name: editing.name.trim(), color: editing.color }).eq("id", editing.id);
    if (error) return setMsg(error.message);
    setEditing(null); load();
  }

  async function remove(c: Cat) {
    if (!confirm(`Excluir "${c.name}"? Lançamentos dessa categoria ficarão como "Não categorizado".`)) return;
    const { error } = await supabase.from("categories").delete().eq("id", c.id);
    if (error) setMsg(error.message);
    load();
  }

  function Coluna({ type, titulo }: { type: "expense" | "income"; titulo: string }) {
    const list = cats.filter((c) => c.type === type);
    return (
      <div className="card p-5">
        <h2 className="mb-3 font-bold">{titulo} <span className="text-sm font-normal text-ink-500">({list.length})</span></h2>
        <div className="mb-4 flex gap-2">
          <input type="color" className="h-10 w-12 cursor-pointer rounded-xl border border-slate-200"
            value={novo[type].color}
            onChange={(e) => setNovo((n) => ({ ...n, [type]: { ...n[type], color: e.target.value } }))} />
          <input className="input flex-1" placeholder={`Nova categoria de ${titulo.toLowerCase()}…`}
            value={novo[type].name}
            onChange={(e) => setNovo((n) => ({ ...n, [type]: { ...n[type], name: e.target.value } }))}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add(type))} />
          <button className="btn-primary" onClick={() => add(type)}><Plus size={16} /></button>
        </div>
        <ul className="space-y-1.5">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
              {editing?.id === c.id ? (
                <>
                  <input type="color" className="h-8 w-10 cursor-pointer rounded-lg border border-slate-200"
                    value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
                  <input className="input flex-1 py-1.5" value={editing.name} autoFocus
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), saveEdit())} />
                  <button onClick={saveEdit} className="rounded-lg p-1.5 text-success-fg hover:bg-success-bg"><Check size={16} /></button>
                  <button onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-ink-300 hover:bg-slate-100"><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: c.color ?? "#CBD5E1" }} />
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  <button onClick={() => setEditing({ id: c.id, name: c.name, color: c.color ?? "#94A3B8" })}
                    className="rounded-lg p-1.5 text-ink-300 hover:bg-brand-50 hover:text-brand-600"><Pencil size={14} /></button>
                  <button onClick={() => remove(c)}
                    className="rounded-lg p-1.5 text-ink-300 hover:bg-danger-bg hover:text-danger-fg"><Trash2 size={14} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      <Header title="Categorias" />
      <div className="space-y-5 p-6">
        {msg && <p className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-fg">{msg}</p>}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Coluna type="expense" titulo="Despesas" />
          <Coluna type="income" titulo="Receitas" />
        </div>
        <p className="text-xs text-ink-500">
          Dica: as regras de categorização aprendidas na Auditoria apontam para estas categorias.
          Ao excluir uma categoria, os lançamentos dela ficam como “Não categorizado” e as regras associadas são removidas.
        </p>
      </div>
    </>
  );
}
