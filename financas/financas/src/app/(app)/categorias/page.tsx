"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, Check, Pencil, X } from "lucide-react";

type Cat = { id: string; name: string; type: "expense" | "income"; color: string | null };
type Editing = { id: string; name: string; color: string } | null;

/**
 * Categorias — gravações pelo servidor (/api/categories).
 * A coluna é um componente de nível superior (fora da página) para o
 * campo de edição não perder o foco a cada tecla.
 */
function CategoryColumn(props: {
  titulo: string;
  list: Cat[];
  novoName: string; novoColor: string;
  onNovoName: (v: string) => void; onNovoColor: (v: string) => void;
  onAdd: () => void;
  editing: Editing;
  onStartEdit: (c: Cat) => void; onEditName: (v: string) => void; onEditColor: (v: string) => void;
  onSaveEdit: () => void; onCancelEdit: () => void;
  onRemove: (c: Cat) => void;
}) {
  const p = props;
  return (
    <div className="card p-5">
      <h2 className="mb-3 font-bold">{p.titulo} <span className="text-sm font-normal text-ink-500">({p.list.length})</span></h2>
      <div className="mb-4 flex gap-2">
        <input type="color" className="h-10 w-12 cursor-pointer rounded-xl border border-slate-200"
          value={p.novoColor} onChange={(e) => p.onNovoColor(e.target.value)} />
        <input className="input flex-1" placeholder={`Nova categoria de ${p.titulo.toLowerCase()}…`}
          value={p.novoName} onChange={(e) => p.onNovoName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), p.onAdd())} />
        <button className="btn-primary" onClick={p.onAdd}><Plus size={16} /></button>
      </div>
      <ul className="space-y-1.5">
        {p.list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
            {p.editing?.id === c.id ? (
              <>
                <input type="color" className="h-8 w-10 cursor-pointer rounded-lg border border-slate-200"
                  value={p.editing.color} onChange={(e) => p.onEditColor(e.target.value)} />
                <input className="input flex-1 py-1.5" value={p.editing.name} autoFocus
                  onChange={(e) => p.onEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), p.onSaveEdit())} />
                <button onClick={p.onSaveEdit} className="rounded-lg p-1.5 text-success-fg hover:bg-success-bg"><Check size={16} /></button>
                <button onClick={p.onCancelEdit} className="rounded-lg p-1.5 text-ink-300 hover:bg-slate-100"><X size={16} /></button>
              </>
            ) : (
              <>
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: c.color ?? "#CBD5E1" }} />
                <span className="flex-1 text-sm font-medium">{c.name}</span>
                <button onClick={() => p.onStartEdit(c)}
                  className="rounded-lg p-1.5 text-ink-300 hover:bg-brand-50 hover:text-brand-600"><Pencil size={14} /></button>
                <button onClick={() => p.onRemove(c)}
                  className="rounded-lg p-1.5 text-ink-300 hover:bg-danger-bg hover:text-danger-fg"><Trash2 size={14} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CategoriasPage() {
  const supabase = createClient();
  const [cats, setCats] = useState<Cat[]>([]);
  const [novo, setNovo] = useState({
    expense: { name: "", color: "#4A6CF7" },
    income: { name: "", color: "#16A34A" },
  });
  const [editing, setEditing] = useState<Editing>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data } = await supabase.from("categories").select("id, name, type, color").order("name");
    setCats((data as Cat[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function api(method: string, body: unknown): Promise<boolean> {
    setMsg(null);
    const res = await fetch("/api/categories", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: `ERRO ao gravar: ${j.error ?? res.statusText}` });
      return false;
    }
    return true;
  }

  async function add(type: "expense" | "income") {
    const { name, color } = novo[type];
    if (!name.trim()) return;
    if (await api("POST", { name, type, color })) {
      setNovo((n) => ({ ...n, [type]: { ...n[type], name: "" } }));
      setMsg({ ok: true, text: "Categoria criada." });
      load();
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (await api("PATCH", { id: editing.id, name: editing.name, color: editing.color })) {
      setEditing(null);
      setMsg({ ok: true, text: "Categoria atualizada." });
      load();
    }
  }

  async function remove(c: Cat) {
    if (!confirm(`Excluir "${c.name}"? Lançamentos dessa categoria ficarão como "Não categorizado".`)) return;
    if (await api("DELETE", { id: c.id })) {
      setMsg({ ok: true, text: "Categoria excluída." });
      load();
    }
  }

  const columnProps = (type: "expense" | "income", titulo: string) => ({
    titulo,
    list: cats.filter((c) => c.type === type),
    novoName: novo[type].name,
    novoColor: novo[type].color,
    onNovoName: (v: string) => setNovo((n) => ({ ...n, [type]: { ...n[type], name: v } })),
    onNovoColor: (v: string) => setNovo((n) => ({ ...n, [type]: { ...n[type], color: v } })),
    onAdd: () => add(type),
    editing,
    onStartEdit: (c: Cat) => setEditing({ id: c.id, name: c.name, color: c.color ?? "#94A3B8" }),
    onEditName: (v: string) => setEditing((e) => (e ? { ...e, name: v } : e)),
    onEditColor: (v: string) => setEditing((e) => (e ? { ...e, color: v } : e)),
    onSaveEdit: saveEdit,
    onCancelEdit: () => setEditing(null),
    onRemove: remove,
  });

  return (
    <>
      <Header title="Categorias" />
      <div className="space-y-5 p-6">
        {msg && (
          <p className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>
            {msg.text}
          </p>
        )}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <CategoryColumn {...columnProps("expense", "Despesas")} />
          <CategoryColumn {...columnProps("income", "Receitas")} />
        </div>
        <p className="text-xs text-ink-500">
          Dica: as regras de categorização aprendidas na Auditoria apontam para estas categorias.
          Ao excluir uma categoria, os lançamentos dela ficam como “Não categorizado”.
        </p>
      </div>
    </>
  );
}
