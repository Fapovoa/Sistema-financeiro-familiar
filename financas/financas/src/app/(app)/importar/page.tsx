"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { createClient } from "@/lib/supabase/client";
import { FAMILY_USER_ID } from "@/lib/user";
import { brl, brDate } from "@/lib/format";
import { FileUp, CheckCircle2, AlertTriangle, Copy, RefreshCcw } from "lucide-react";
import clsx from "clsx";

type PreviewTx = {
  transaction_date: string; description_original: string; description_clean: string;
  amount: number; type: string; category_id: string | null; category_suggestion: string | null;
  confidence_score: number; is_installment: boolean; installment_number: number | null;
  installment_total: number | null; is_recurring_candidate: boolean; is_card_purchase: boolean;
  invoice_reference_month?: string | null; invoice_due_date?: string | null;
  affects_cash_flow: boolean; affects_category_report: boolean;
  deduplication_status: string; duplicate_match_id?: string | null;
  suggested_action: "import" | "ignore" | "audit" | "reconcile";
  action?: "import" | "ignore" | "audit" | "reconcile";
  learn_rename?: boolean;
};

export default function ImportarPage() {
  const supabase = createClient();
  const [accounts, setAccounts] = useState<{ id: string; name: string; type: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("bank_statement");
  const [accountId, setAccountId] = useState("");
  const [refMonth, setRefMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [rows, setRows] = useState<PreviewTx[]>([]);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("accounts").select("id, name, type").then(({ data }) => setAccounts(data ?? []));
    supabase.from("categories").select("id, name").eq("type", "expense").then(({ data }) => setCategories(data ?? []));
  }, []);

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !accountId) return setError("Selecione o arquivo e a conta/cartão.");
    setLoading(true); setError(null); setDone(null); setPreview(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("document_type", docType);
    fd.append("account_id", accountId);
    fd.append("reference_month", refMonth);
    const res = await fetch("/api/import/parse", { method: "POST", body: fd });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error ?? "Falha ao ler o arquivo.");
    setPreview(json);
    setRows(json.transactions.map((t: PreviewTx) => ({ ...t, action: t.suggested_action })));
  }

  async function confirm() {
    if (!preview || !file) return;
    setLoading(true); setError(null);

    let filePath: string | null = null;
    {
      const path = `${FAMILY_USER_ID}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
      if (!upErr) filePath = path;
    }

    const res = await fetch("/api/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_hash: preview.file_hash,
        file_name: preview.file_name,
        file_path: filePath,
        document_type: docType,
        account_id: accountId,
        institution: preview.detected.institution,
        invoice: preview.detected.invoice,
        transactions: rows,
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error ?? "Falha ao importar.");
    setDone(json); setPreview(null); setRows([]); setFile(null);
  }

  function setRow(i: number, patch: Partial<PreviewTx>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  return (
    <>
      <Header title="Importação de documentos" />
      <div className="space-y-6 p-6">
        <form onSubmit={parse} className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Tipo de documento</span>
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="bank_statement">Extrato bancário</option>
              <option value="credit_card_statement">Fatura de cartão</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Conta / cartão</span>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Selecione…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Competência</span>
            <input type="month" className="input" value={refMonth} onChange={(e) => setRefMonth(e.target.value)} />
          </label>
          <label className="text-sm md:col-span-1">
            <span className="mb-1 block font-medium">Arquivo (PDF ou Excel)</span>
            <input type="file" accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="flex items-end">
            <button className="btn-primary w-full justify-center" disabled={loading}>
              <FileUp size={16} /> {loading ? "Lendo…" : "Ler arquivo"}
            </button>
          </div>
        </form>

        {error && <p className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</p>}
        {accounts.length === 0 && (
          <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn-fg">
            Cadastre primeiro sua conta ou cartão em <a href="/contas" className="font-semibold underline">Contas &amp; cartões</a>.
          </p>
        )}

        {done && (
          <div className="card flex items-center gap-3 p-5 text-sm">
            <CheckCircle2 className="text-success-fg" />
            <p>
              Importação concluída: <b>{done.imported}</b> importados, <b>{done.ignored}</b> ignorados,{" "}
              <b>{done.reconciled}</b> reconciliados, <b>{done.audits}</b> enviados para auditoria.
            </p>
          </div>
        )}

        {preview && (
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
              <div className="mr-auto">
                <h2 className="font-bold">Prévia — {preview.detected.institution ?? "instituição não identificada"}</h2>
                <p className="text-sm text-ink-500">
                  {preview.summary.found} lançamentos · {preview.summary.new} novos ·{" "}
                  <span className="text-warn-fg">{preview.summary.duplicates} possíveis duplicidades</span> ·{" "}
                  {preview.summary.reconcile} para reconciliar · {preview.summary.audit} para auditoria
                </p>
                {preview.detected.invoice?.due_date && (
                  <p className="text-sm text-ink-500">
                    Fatura de {brl(preview.detected.invoice.total_amount ?? 0)} com vencimento em{" "}
                    <b>{brDate(preview.detected.invoice.due_date)}</b> — o caixa será impactado apenas nessa data.
                  </p>
                )}
                {preview.already_imported && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-warn-fg">
                    <Copy size={14} /> Este arquivo já foi importado antes ({preview.already_imported.file_name}).
                  </p>
                )}
                {preview.warnings?.map((w: string, i: number) => (
                  <p key={i} className="mt-1 flex items-center gap-1 text-sm text-warn-fg"><AlertTriangle size={14} /> {w}</p>
                ))}
              </div>
              <button className="btn-primary" onClick={confirm} disabled={loading || !!preview.already_imported}>
                <CheckCircle2 size={16} /> Confirmar importação
              </button>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3">Categoria</th>
                    <th className="px-4 py-3">Sinais</th>
                    <th className="px-4 py-3">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((t, i) => (
                    <tr key={i} className={clsx(t.action === "ignore" && "opacity-45")}>
                      <td className="whitespace-nowrap px-4 py-2.5">{brDate(t.transaction_date)}</td>
                      <td className="px-4 py-2.5">
                        <input
                          className="input py-1.5 font-medium"
                          value={t.description_clean}
                          title="Edite o nome: o sistema aprende e usa este nome nas próximas importações"
                          onChange={(e) => setRow(i, { description_clean: e.target.value, learn_rename: true })}
                        />
                      </td>
                      <td className={clsx("whitespace-nowrap px-4 py-2.5 text-right font-semibold",
                        t.amount < 0 ? "text-danger-fg" : "text-success-fg")}>{brl(t.amount)}</td>
                      <td className="px-4 py-2.5">
                        <select className="input py-1.5" value={t.category_id ?? ""}
                          onChange={(e) => setRow(i, { category_id: e.target.value || null })}>
                          <option value="">{t.category_suggestion ? `Sugerida: ${t.category_suggestion}` : "Sem categoria"}</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <span className="text-xs text-ink-500">confiança {(t.confidence_score * 100).toFixed(0)}%</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {t.is_card_purchase && <Tag>cartão</Tag>}
                          {t.is_installment && <Tag tone="warn">parcela {t.installment_number}/{t.installment_total}</Tag>}
                          {t.is_recurring_candidate && <Tag tone="info">recorrente?</Tag>}
                          {t.deduplication_status === "possible_duplicate" && <Tag tone="danger">duplicado?</Tag>}
                          {t.deduplication_status === "reconcile" && <Tag tone="info"><RefreshCcw size={11} /> reconciliar</Tag>}
                          {!t.affects_cash_flow && <Tag>fora do caixa</Tag>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select className="input py-1.5" value={t.action}
                          onChange={(e) => setRow(i, { action: e.target.value as PreviewTx["action"] })}>
                          <option value="import">Importar</option>
                          <option value="ignore">Ignorar</option>
                          <option value="audit">Auditar</option>
                          <option value="reconcile">Reconciliar</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "danger" | "info" }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
      tone === "neutral" && "bg-slate-100 text-ink-500",
      tone === "warn" && "bg-warn-bg text-warn-fg",
      tone === "danger" && "bg-danger-bg text-danger-fg",
      tone === "info" && "bg-brand-50 text-brand-600")}>{children}</span>
  );
}
