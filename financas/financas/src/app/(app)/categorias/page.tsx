"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, Check, Pencil, X } from "lucide-react";
import clsx from "clsx";

type Cat = { id: string; name: string; type: "expense" | "income"; color: string | null; nature: string };
type Editing = { id: string; name: string; color: string } | null;

const NATURES = [
  { v: "undefined", label: "—" },
  { v: "fixed", label: "Fixa" },
  { v: "variable", label: "Variável" },
];

/**
 * Categorias — gravações pelo servidor (/api/categories).
 * A coluna é um componente de nível superior (fora da página) para o
 * campo de edição não perder o foco a cada tecla.
 * Despesas têm natureza (fixa × variável); receitas não.
 */
function CategoryColumn(props: {
  titulo: string;
  showNature: boolean;
  list: Cat[];
  novoName: string; novoColor: string;
  onNovoName: (v: string) => void; onNovoColor: (v: string) => void;
  onAdd: () => void;
  editing: Editing;
  onStartEdit: (c: Cat) => void; onEditName: (v: string) => void; onEditColor: (v: string) => void;
  onSaveEdit: () => void; onCancelEdit: () => void;
  onRemove: (c: Cat) => void;
  onSetNature: (c: Cat, nature: string) => void;
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
                <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                {p.showNature && (
                  <select
                    className={clsx(
                      "rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold outline-none",
                      c.nature === "fixed" && "bg-brand-50 text-brand-600",
                      c.nature === "variable" && "bg-warn-bg text-warn-fg",
                      (c.nature ?? "undefined") === "undefined" && "bg-white text-ink-500",
                    )}
                    value={c.nature ?? "undefined"}
                    onChange={(e) => p.onSetNature(c, e.target.value)}
                    title="Fixa = repete todo mês com valor previsível; Variável = oscila">
                    {NATURES.map((n) => <option key={n.v} value={n.v}>{n.label}</option>)}
                  </select>
                )}
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
    const { data } = await supabase.from("categories").select("id, name, type, color, nature").order("name");
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

  async function setNature(c: Cat, nature: string) {
    // atualiza na tela na hora; se falhar, recarrega para reverter
    setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, nature } : x)));
    if (!(await api("PATCH", { id: c.id, nature }))) load();
  }

  const fixas = cats.filter((c) => c.type === "expense" && c.nature === "fixed").length;
  const variaveis = cats.filter((c) => c.type === "expense" && c.nature === "variable").length;
  const semDef = cats.filter((c) => c.type === "expense" && c.nature !== "fixed" && c.nature !== "variable").length;

  const columnProps = (type: "expense" | "income", titulo: string) => ({
    titulo,
    showNature: type === "expense",
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
    onSetNature: setNature,
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
        <p className="text-sm text-ink-500">
          Natureza das despesas: <b className="text-brand-600">{fixas} fixas</b> ·{" "}
          <b className="text-warn-fg">{variaveis} variáveis</b>
          {semDef > 0 && <> · <b className="text-ink-700">{semDef} sem definir</b></>}.{" "}
          Ajuste no seletor ao lado de cada categoria de despesa.
        </p>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <CategoryColumn {...columnProps("expense", "Despesas")} />
          <CategoryColumn {...columnProps("income", "Receitas")} />
        </div>
        <p className="text-xs text-ink-500">
          Fixa = repete todo mês com valor previsível (aluguel, assinatura, mensalidade). Variável = oscila (mercado, restaurante, combustível).
          As regras de categorização aprendidas na Auditoria também apontam para estas categorias.
        </p>
      </div>
    </>
  );
}
