"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { brl, brDate } from "@/lib/format";
import { Plus, Trash2, Pencil, X, Play, Pause } from "lucide-react";
import clsx from "clsx";

type Rule = {
  id: string; kind: "expense" | "income"; description: string; amount: number;
  category_id: string | null; account_id: string | null;
  day_of_month: number; start_date: string; end_date: string | null;
  months_ahead: number; active: boolean; notes: string | null;
  categories?: { name: string; color: string | null } | null;
  accounts?: { name: string } | null;
};

const EMPTY = {
  kind: "expense" as "expense" | "income",
  description: "", amount: "", category_id: "", account_id: "",
  day_of_month: "1", start_date: new Date().toISOString().slice(0, 10),
  end_date: "", months_ahead: "3", notes: "",
};

/**
 * Recorrências: contas fixas (receitas e despesas) com período de vigência.
 * As previsões futuras são geradas pelo servidor (status=previsto) e aparecem
 * no Fluxo de caixa. Inativar apaga as previsões futuras; reativar recria.
 */
export default function RecorrenciasPage() {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; type: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [{ data: r }, { data: c }, { data: a }] = await Promise.all([
      supabase.from("recurrences")
        .select("*, categories(name, color), accounts(name)")
        .order("active", { ascending: false })
        .order("day_of_month"),
      supabase.from("categories").select("id, name, type").order("name"),
      supabase.from("accounts").select("id, name").neq("type", "credit_card").order("name"),
    ]);
    setRules((r as Rule[]) ?? []); setCats(c ?? []); setAccounts(a ?? []);
  }
  useEffect(() => { load(); }, []);

  function startEdit(r: Rule) {
    setEditing(r.id);
    setForm({
      kind: r.kind, description: r.description,
      amount: String(r.amount).replace(".", ","),
      category_id: r.category_id ?? "", account_id: r.account_id ?? "",
      day_of_month: String(r.day_of_month), start_date: r.start_date,
      end_date: r.end_date ?? "", months_ahead: String(r.months_ahead), notes: r.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function payloadFromForm(extra: Partial<Rule> = {}) {
    return {
      id: editing ?? undefined,
      kind: form.kind,
      description: form.description,
      amount: parseFloat(form.amount.replace(/\./g, "").replace(",", ".")),
      category_id: form.category_id || null,
      account_id: form.account_id || null,
      day_of_month: parseInt(form.day_of_month, 10),
      start_date: form.start_date,
      end_date: form.end_date || null,
      months_ahead: parseInt(form.months_ahead, 10) || 3,
      active: true,
      notes: form.notes || null,
      ...extra,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const res = await fetch("/api/recurrences", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromForm(editing ? { active: rules.find((r) => r.id === editing)?.active ?? true } : {})),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO ao gravar: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: editing ? `Recorrência atualizada — ${json.forecasts} previsões futuras regeradas.` : `Recorrência criada — ${json.forecasts} previsões lançadas no caixa.` });
    setForm({ ...EMPTY }); setEditing(null); load();
  }

  async function toggleActive(r: Rule) {
    setBusy(r.id); setMsg(null);
    const res = await fetch("/api/recurrences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: r.id, kind: r.kind, description: r.description, amount: r.amount,
        category_id: r.category_id, account_id: r.account_id,
        day_of_month: r.day_of_month, start_date: r.start_date, end_date: r.end_date,
        months_ahead: r.months_ahead, active: !r.active, notes: r.notes,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: `ERRO: ${json.error ?? res.statusText}` });
    setMsg({ ok: true, text: r.active ? "Recorrência inativada —
