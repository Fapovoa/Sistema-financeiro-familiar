"use client";
import { useState } from "react";
import { Wallet } from "lucide-react";

/**
 * Tela de login por palavra-chave (a mesma da página Perfil).
 * Validação pelo servidor (/api/auth/login); em caso de acerto,
 * o cookie de acesso é gravado e o middleware libera o site.
 */
export default function LoginPage() {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErro(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setErro(json.error ?? "Não foi possível entrar.");
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-brand-500 via-brand-600 to-indigo-900 px-4">

      {/* Aviãozinho cruzando o céu (viagens!) */}
      <div className="plane pointer-events-none absolute top-[12%] text-4xl md:text-5xl">✈️</div>

      {/* Elementos flutuando ao fundo */}
      <div className="float-slow pointer-events-none absolute left-[8%] top-[22%] text-3xl opacity-80">💸</div>
      <div className="float-mid pointer-events-none absolute right-[10%] top-[30%] text-3xl opacity-80">📈</div>
      <div className="float-fast pointer-events-none absolute left-[14%] bottom-[18%] text-3xl opacity-80">🏖️</div>
      <div className="float-mid pointer-events-none absolute right-[16%] bottom-[12%] text-3xl opacity-80">🏠</div>
      <div className="float-slow pointer-events-none absolute right-[28%] top-[10%] text-2xl opacity-70">💰</div>

      {/* Cartão central */}
      <div className={`relative w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl ${shake ? "shake" : ""}`}>

        {/* Cofrinho sorridente recebendo moedas */}
        <div className="relative mx-auto mb-2 h-28 w-28">
          <div className="coin absolute left-1/2 top-0 -translate-x-1/2 text-2xl">🪙</div>
          <div className="coin coin-2 absolute left-1/2 top-0 -translate-x-1/2 text-xl">🪙</div>
          <div className="piggy absolute inset-x-0 bottom-0 text-center text-7xl">🐷</div>
          <div className="smile pointer-events-none absolute inset-x-0 bottom-1 text-center text-2xl">😊</div>
        </div>

        <h1 className="flex items-center justify-center gap-2 text-center text-xl font-bold tracking-tight text-ink-900">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-500 text-white"><Wallet size={16} /></span>
          Finanças Familiares
        </h1>
        <p className="mt-1 text-center text-sm text-ink-500">Digite a palavra-chave da família para entrar</p>

        <form onSubmit={entrar} className="mt-6 space-y-3">
          <input
            type="password"
            autoFocus
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            placeholder="Palavra-chave"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {erro && (
            <p className="rounded-xl bg-danger-bg px-3 py-2 text-center text-sm font-medium text-danger-fg">{erro}</p>
          )}
          <button
            className="w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            disabled={loading}>
            {loading ? "Abrindo o cofrinho…" : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">A palavra-chave é definida na página Perfil.</p>
      </div>

      {/* Animações */}
      <style>{`
        @keyframes plane-fly {
          0%   { transform: translateX(-15vw) translateY(0) rotate(4deg); }
          50%  { transform: translateX(50vw) translateY(-24px) rotate(-2deg); }
          100% { transform: translateX(115vw) translateY(0) rotate(4deg); }
        }
        .plane { left: 0; animation: plane-fly 14s linear infinite; }

        @keyframes coin-drop {
          0%   { transform: translate(-50%, -10px) scale(1); opacity: 0; }
          15%  { opacity: 1; }
          70%  { transform: translate(-50%, 42px) scale(0.9); opacity: 1; }
          100% { transform: translate(-50%, 52px) scale(0.4); opacity: 0; }
        }
        .coin { animation: coin-drop 1.8s ease-in infinite; }
        .coin-2 { animation-delay: 0.9s; }

        @keyframes piggy-bounce {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        .piggy { animation: piggy-bounce 1.8s ease-in-out infinite; }

        @keyframes smile-pop {
          0%, 60%, 100% { opacity: 0; transform: scale(0.6); }
          70%, 90%      { opacity: 1; transform: scale(1); }
        }
        .smile { animation: smile-pop 1.8s ease-in-out infinite; }

        @keyframes float-y {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-14px); }
        }
        .float-slow { animation: float-y 6s ease-in-out infinite; }
        .float-mid  { animation: float-y 4.5s ease-in-out infinite; }
        .float-fast { animation: float-y 3.5s ease-in-out infinite; }

        @keyframes wing-flap { 0%,100% { filter: none; } 50% { filter: brightness(1.15); } }

        @keyframes shake-x {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .shake { animation: shake-x 0.5s ease-in-out; }
      `}</style>
    </main>
  );
}
