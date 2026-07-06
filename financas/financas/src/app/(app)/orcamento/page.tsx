"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import clsx from "clsx";
import { endOfMonth, format } from "date-fns";

type Cat = { id: string; name: string; color: string | null; nature: string };

/**
 * Orçamento por categoria.
 * O usuário define um alvo mensal por categoria (vale para todo mês) e a página
 * compara com o realizado do mês escolhido.
 * Base da comparação: VISÃO ANALÍTICA (affects_category_report=true) —
 * compras individuais do cartão entram na sua categoria; o total consolidado
 * da fatura fica de fora (não conta duas vezes). Gravação do alvo pelo servidor.
 */
export default function OrcamentoPage() {
  const supabase = createClient();
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [cats, setCats] = useState<Cat[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [realizado, setRealizado] = useState<Record<string, number>>({});
  const [previsto, setPrevisto] = useState<Record<string, number>>({});
  const [uncategorized, setUncategorized] = useState(0);
  const [targets, setTargets] = useState<Record<string, string>>({}); // texto editável por categoria
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(m = month) {
    setLoading(true); setMsg(null);
    const start = m + "-01";
    const end = format(endOfMonth(new Date(start + "T12:00:00")), "yyyy-MM-dd");

    const [{ data: c }, { data: bg }, { data: txs }] = await Promise.all([
      supabase.from("categories").select("id, name, color, nature").eq("type", "expense").order("name"),
      supabase.from("budgets").select("category_id, amount"),
      supabase.from("transactions")
        .select("amount, category_id, status")
        .lt("amount", 0)
        .neq("type", "ignored")
        .eq("affects_category_report", true)
        .gte("transaction_date", start).lte("transaction_date", end)
        .limit(5000),
    ]);

    const categorias = (c as Cat[]) ?? [];
    setCats(categorias);

    const bMap: Record<string, number> = {};
    (bg ?? []).forEach((r: any) => { bMap[r.category_id] = Number(r.amount); });
    setBudgets(bMap);

    // inicializa os campos editáveis a partir dos alvos salvos
    const tMap: Record<string, string> = {};
    categorias.forEach((cat) => {
      tMap[cat.id] = bMap[cat.id] ? String(bMap[cat.id]).replace(".", ",") : "";
    });
    setTargets(tMap);

    const rMap: Record<string, number> = {};
    const pMap: Record<string, number> = {};
    let semCat = 0;
    (txs ?? []).forEach((t: any) => {
      const val = Math.abs(Number(t.amount));
      const forecast = t.status === "forecast";
      if (!t.category_id) { if (!forecast) semCat += val; return; }
      if (forecast) pMap[t.category_id] = (pMap[t.category_id] ?? 0) + val;
      else rMap[t.category_id] = (rMap[t.category_id] ?? 0) + val;
    });
    setRealizado(rMap);
    setPrevisto(pMap);
    setUncategorized(semCat);
    setLoading(false);
  }
  useEffect(() => { load(month); }, [month]);

  async function saveTarget(catId: string) {
    const raw = targets[catId] ?? "";
    const value = raw.trim() === "" ? 0 : parseFloat(raw.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(value)) { setMsg({ ok: false, text: "Valor inválido." }); return; }
    const atual = budgets[catId] ?? 0;
    if (value === atual) return; // não mudou, não grava
    setBusy(catId); setMsg(null);
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: catId, amount: value }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` }); load(); return; }
    setBudgets((prev) => {
      const next = { ...prev };
      if (value === 0) delete next[catId]; else next[catId] = value;
      return next;
    });
  }

  const totalOrcado = cats.reduce((s, c) => s + (budgets[c.id] ?? 0), 0);
  const totalRealizado = cats.reduce((s, c) => s + (realizado[c.id] ?? 0), 0) + uncategorized;
  const totalPrevisto = cats.reduce((s, c) => s + (previsto[c.id] ?? 0), 0);
  const pctGeral = totalOrcado > 0 ? (totalRealizado / totalOrcado) * 100 : 0;
  const saldoOrcamento = totalOrcado - totalRealizado;

  function barColor(pct: number) {
    if (pct > 100) return "bg-rose-500";
    if (pct >= 80) return "bg-amber-500";
    return "bg-emerald-500";
  }

  function situacao(orcado: number, real: number) {
    if (orcado === 0) return real > 0 ? { txt: "sem alvo", cls: "bg-slate-100 text-ink-500" } : null;
    const pct = (real / orcado) * 100;
    if (pct > 100) return { txt: "estourou", cls: "bg-danger-bg text-danger-fg" };
    if (pct >= 80) return { txt: "atenção", cls: "bg-warn-bg text-warn-fg" };
    return { txt: "dentro", cls: "bg-success-bg text-success-fg" };
  }

  return (
    <>
      <Header title="Orçamento" />
      <div className="space-y-5 p-6">
        {msg && (
          <p className={clsx("rounded-xl px-4 py-3 text-sm", msg.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
            {msg.text}
          </p>
        )}

        {/* Resumo do mês + seletor */}
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">Resumo do mês</h2>
            <label className="text-sm">
              <span className="mr-2 font-medium">Mês:</span>
              <input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-ink-500">Orçado</p>
              <p className="text-xl font-bold">{brl(totalOrcado)}</p>
            </div>
            <div>
              <p className="text-sm text-ink-500">Realizado</p>
              <p className="text-xl font-bold text-danger-fg">{brl(totalRealizado)}</p>
              {totalPrevisto > 0 && <p className="text-[11px] text-ink-500">+ {brl(totalPrevisto)} previsto</p>}
            </div>
            <div>
              <p className="text-sm text-ink-500">{saldoOrcamento >= 0 ? "Ainda posso gastar" : "Estourei o orçamento em"}</p>
              <p className={clsx("text-xl font-bold", saldoOrcamento >= 0 ? "text-success-fg" : "text-danger-fg")}>
                {brl(Math.abs(saldoOrcamento))}
              </p>
            </div>
          </div>
          {totalOrcado > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-ink-500">
                <span>Uso geral do orçamento</span><span>{Math.round(pctGeral)}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100">
                <div className={clsx("h-2.5 rounded-full", barColor(pctGeral))} style={{ width: `${Math.min(100, pctGeral)}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Tabela por categoria */}
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right">Orçado (alvo)</th>
                <th className="px-4 py-3 text-right">Realizado</th>
                <th className="px-4 py-3">Uso</th>
                <th className="px-4 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-500">Carregando…</td></tr>
              )}

              {!loading && cats.map((c) => {
                const orcado = budgets[c.id] ?? 0;
                const real = realizado[c.id] ?? 0;
                const prev = previsto[c.id] ?? 0;
                const pct = orcado > 0 ? (real / orcado) * 100 : 0;
                const sit = situacao(orcado, real);
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color ?? "#CBD5E1" }} />
                        <span className="font-medium">{c.name}</span>
                        {c.nature === "fixed" && <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">fixa</span>}
                        {c.nature === "variable" && <span className="rounded-md bg-warn-bg px-1.5 py-0.5 text-[10px] font-semibold text-warn-fg">variável</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        className="input w-32 py-1.5 text-right"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={targets[c.id] ?? ""}
                        disabled={busy === c.id}
                        onChange={(e) => setTargets((t) => ({ ...t, [c.id]: e.target.value }))}
                        onBlur={() => saveTarget(c.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-danger-fg">
                      {real ? brl(real) : "—"}
                      {prev > 0 && <p className="text-[11px] font-normal text-ink-500">+ {brl(prev)} previsto</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      {orcado > 0 ? (
                        <div className="min-w-[120px]">
                          <div className="mb-1 flex justify-between text-[11px] text-ink-500">
                            <span>{brl(real)} / {brl(orcado)}</span><span>{Math.round(pct)}%</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100">
                            <div className={clsx("h-2 rounded-full", barColor(pct))} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </div>
                      ) : <span className="text-xs text-ink-500">defina um alvo</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {sit && <span className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold", sit.cls)}>{sit.txt}</span>}
                    </td>
                  </tr>
                );
              })}

              {!loading && uncategorized > 0 && (
                <tr className="bg-slate-50/40">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-300" />
                      <span className="font-medium text-ink-500">Não categorizado</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-ink-500">—</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-danger-fg">{brl(uncategorized)}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-500">classifique na Auditoria</td>
                  <td className="px-4 py-2.5" />
                </tr>
              )}

              {!loading && cats.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-500">
                  Nenhuma categoria de despesa. Crie categorias em <a href="/categorias" className="font-semibold text-brand-600 underline">Categorias</a>.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-ink-500">
          O alvo é digitado por categoria e vale para todo mês (troque o mês no topo para comparar outro período).
          O “realizado” usa a visão analítica: compras do cartão contam na categoria delas; o total da fatura fica de fora para não contar duas vezes.
          “Previsto” são parcelas futuras/recorrências que caem no mês.
        </p>
      </div>
    </>
  );
}
