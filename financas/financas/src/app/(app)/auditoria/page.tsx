"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { FAMILY_USER_ID } from "@/lib/user";
import { brl, brDate } from "@/lib/format";
import { normalizeDescription } from "@/lib/parsers/normalize";
import { CheckCircle2, EyeOff, ShieldCheck } from "lucide-react";
import clsx from "clsx";

type Item = {
  id: string; reason: string; confidence_score: number | null; suggested_category_id: string | null;
  transactions: {
    id: string; transaction_date: string; description_clean: string; description_original: string;
    amount: number; type: string; is_installment: boolean; is_recurring: boolean; category_id: string | null;
  };
};

/**
 * Auditoria: resolve lançamentos duvidosos.
 * Ao confirmar uma categoria, salva uma regra em categorization_rules —
 * lançamentos futuros com descrição parecida serão categorizados sozinhos.
 */
export default function AuditoriaPage() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; type: string }[]>([]);
  const [choice, setChoice] = useState<Record<string, { category_id?: string; type?: string; recurring?: boolean; learn: boolean; name?: string }>>({});
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase.from("audit_items")
        .select("id, reason, confidence_score, suggested_category_id, transactions(id, transaction_date, description_clean, description_original, amount, type, is_installment, is_recurring, category_id)")
        .eq("status", "pending").order("created_at", { ascending: true }),
      supabase.from("categories").select("id, name, type").order("name"),
    ]);
    setItems((a as unknown as Item[]) ?? []);
    setCats(c ?? []);
  }
  useEffect(() => { load(); }, []);

  function setC(id: string, patch: Partial<{ category_id: string; type: string; recurring: boolean; learn: boolean; name: string }>) {
    setChoice((s) => ({ ...s, [id]: { ...{ learn: true }, ...s[id], ...patch } }));
  }

  async function resolve(item: Item) {
    const c = choice[item.id] ?? { learn: true };
    const categoryId = c.category_id ?? item.suggested_category_id ?? null;
    const newName = (c.name ?? item.transactions.description_clean)?.trim();

    await supabase.from("transactions").update({
      category_id: categoryId,
      type: (c.type as never) ?? item.transactions.type,
      is_recurring: c.recurring ?? item.transactions.is_recurring,
      description_clean: newName || item.transactions.description_clean,
      confidence_score: 1,
    }).eq("id", item.transactions.id);

    // Renomeou? Aprende: próximas importações desse estabelecimento já chegam com o novo nome
    if (newName && newName !== item.transactions.description_clean) {
      const np = normalizeDescription(item.transactions.description_original || item.transactions.description_clean);
      if (np.length >= 3) {
        await supabase.from("rename_rules").upsert({
          user_id: FAMILY_USER_ID,
          pattern: item.transactions.description_original,
          normalized_pattern: np,
          new_name: newName,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,normalized_pattern" });
      }
    }

    // Aprendizado: correção vira regra para descrições semelhantes
    if (c.learn !== false && categoryId) {
      const normalized = normalizeDescription(item.transactions.description_clean || item.transactions.description_original);
      if (normalized.length >= 3) {
        await supabase.from("categorization_rules").upsert({
          pattern: item.transactions.description_clean,
          normalized_pattern: normalized,
          category_id: categoryId,
          confidence: 1,
          created_from_transaction_id: item.transactions.id,
          user_id: FAMILY_USER_ID,
        }, { onConflict: "user_id,normalized_pattern" });
      }
    }

    // Propaga para TODOS os lançamentos idênticos (passados e parcelas futuras já criadas)
    const oldName = item.transactions.description_clean;
    const propagate: Record<string, unknown> = {};
    if (categoryId) propagate.category_id = categoryId;
    if (newName && newName !== oldName) propagate.description_clean = newName;
    if (Object.keys(propagate).length && oldName) {
      const { data: siblings } = await supabase
        .from("transactions")
        .select("id")
        .eq("description_clean", oldName)
        .neq("id", item.transactions.id);
      const ids = (siblings ?? []).map((x) => x.id);
      if (ids.length) {
        await supabase.from("transactions").update(propagate).in("id", ids);
        // Resolve também as pendências de auditoria dos irmãos idênticos
        await supabase.from("audit_items")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .in("transaction_id", ids)
          .eq("status", "pending");
      }
    }

    await supabase.from("audit_items").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", item.id);
    setFlash(`“${newName || oldName}” resolvido — aplicado a todos os lançamentos idênticos e regra salva para as próximas importações.`);
    load();
  }

  async function ignore(item: Item) {
    await supabase.from("transactions").update({ status: "ignored", type: "ignored" }).eq("id", item.transactions.id);
    await supabase.from("audit_items").update({ status: "ignored", resolved_at: new Date().toISOString() }).eq("id", item.id);
    load();
  }

  return (
    <>
      <Header title="Auditoria" />
      <div className="space-y-4 p-6">
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <ShieldCheck size={16} className="text-brand-600" />
          Lançamentos que o sistema não conseguiu classificar com segurança. Cada correção vira regra de categorização automática.
        </p>
        {flash && <p className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success-fg">{flash}</p>}

        {items.length === 0 && (
          <div className="card p-10 text-center text-sm text-ink-500">
            Nada pendente de auditoria. 🎉
          </div>
        )}

        {items.map((it) => {
          const c = choice[it.id] ?? { learn: true };
          return (
            <div key={it.id} className="card grid grid-cols-1 gap-4 p-5 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input w-64 py-1.5 font-semibold"
                    value={choice[it.id]?.name ?? it.transactions.description_clean}
                    title="Edite o nome: o sistema aprende e usa esse nome nas próximas importações"
                    onChange={(e) => setC(it.id, { name: e.target.value })} />
                  <span className={clsx("font-bold", it.transactions.amount < 0 ? "text-danger-fg" : "text-success-fg")}>
                    {brl(it.transactions.amount)}
                  </span>
                  <span className="text-xs text-ink-500">{brDate(it.transactions.transaction_date)}</span>
                  <span className="rounded-md bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-fg">{it.reason}</span>
                  {it.confidence_score != null && (
                    <span className="text-xs text-ink-500">confiança {(Number(it.confidence_score) * 100).toFixed(0)}%</span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-medium text-ink-500">Categoria correta</span>
                    <select className="input py-2" value={c.category_id ?? it.suggested_category_id ?? ""}
                      onChange={(e) => setC(it.id, { category_id: e.target.value })}>
                      <option value="">Escolher…</option>
                      {cats.filter((x) => (it.transactions.amount < 0 ? x.type === "expense" : x.type === "income"))
                        .map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-medium text-ink-500">Tipo do lançamento</span>
                    <select className="input py-2" value={c.type ?? it.transactions.type}
                      onChange={(e) => setC(it.id, { type: e.target.value })}>
                      <option value="expense">Despesa</option>
                      <option value="income">Receita</option>
                      <option value="transfer">Transferência</option>
                      <option value="credit_card_payment">Pagamento de cartão</option>
                      <option value="refund">Estorno</option>
                    </select>
                  </label>
                  <div className="flex items-end gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={c.recurring ?? it.transactions.is_recurring}
                        onChange={(e) => setC(it.id, { recurring: e.target.checked })} />
                      Recorrente
                    </label>
                    <label className="flex items-center gap-2" title="Salvar regra para categorizar descrições parecidas automaticamente">
                      <input type="checkbox" checked={c.learn}
                        onChange={(e) => setC(it.id, { learn: e.target.checked })} />
                      Aprender regra
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 lg:flex-col">
                <button className="btn-primary" onClick={() => resolve(it)}>
                  <CheckCircle2 size={16} /> Confirmar
                </button>
                <button className="btn-ghost" onClick={() => ignore(it)}>
                  <EyeOff size={16} /> Ignorar lançamento
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
