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
      supabase.from("categories").select("id, name, color, nature").eq("type",
