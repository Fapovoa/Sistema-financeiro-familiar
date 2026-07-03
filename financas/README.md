# Finanças Familiares — Parte 1

Sistema de controle financeiro familiar (Next.js 15 + TypeScript + Tailwind + Supabase), com importação automática de PDFs de extratos e faturas.

## O que está nesta entrega (Parte 1)

**Páginas completas**
- **Despesas** (`/despesas`) — visão de caixa × visão analítica, filtros por mês/categoria/status/texto
- **Cartões** (`/cartoes`) — cartões, faturas por competência, compras, total por categoria na fatura, parcelas futuras comprometidas, limite comprometido
- **Auditoria** (`/auditoria`) — classificação de lançamentos duvidosos; cada correção vira regra automática (`categorization_rules`)
- **Receitas** (`/receitas`) — cadastro manual; recorrentes projetadas 3 meses à frente como "previstas"
- **Dashboard** (`/dashboard`) — KPIs, alertas, donut por categoria, saldo acumulado, receitas × despesas, top 10
- **Importar PDFs** (`/importar`) — upload, prévia com duplicidades/reconciliação/parcelas, confirmação
- Login/cadastro (Supabase Auth) + proteção de rotas via middleware

**Motor**
- Parsers reais: extrato Itaú, fatura Itaú, extrato Banco Inter, fatura Nubank (`src/lib/parsers`)
- Categorização em camadas: regras do usuário → palavras-chave → auditoria (`src/lib/engine/categorize.ts`)
- Deduplicação por hash + fuzzy (valor, janela de datas, similaridade) (`src/lib/engine/dedupe.ts`)
- Parcelamentos: detecção "01/10", "Parcela 5/12" + provisão de parcelas futuras nas faturas futuras
- Regra-chave de cartão: compra individual `affects_cash_flow=false` / fatura total no vencimento `affects_cash_flow=true`
- Reconciliação: pagamento da fatura no extrato marca a fatura como paga, sem duplicar despesa

**Banco**: `supabase/migrations/001_initial_schema.sql` — todas as tabelas, RLS por `user_id`, bucket privado `documents`, categorias padrão criadas por trigger no cadastro.

## Próximas entregas (Parte 2)
- Fluxo de caixa diário (tabela + gráfico, 30/60/90 dias)
- Contas & cartões (CRUD) e Categorias (CRUD)
- Refinos: reprocessar documento, edição inline de despesas, recorrência automática em despesas

> As páginas `/fluxo-caixa`, `/contas` e `/categorias` estão como placeholder para o app compilar.

## Como rodar

1. Crie um projeto no [Supabase](https://supabase.com) e rode o SQL de `supabase/migrations/001_initial_schema.sql` no SQL Editor.
2. Copie `.env.example` para `.env.local` e preencha URL + anon key do projeto.
3. `npm install && npm run dev`
4. Cadastre-se em `/login`, crie sua conta bancária e cartão em `/contas` (Parte 2 — por enquanto insira via SQL ou aguarde a próxima entrega)*, e importe os PDFs em `/importar`.

\* Enquanto a página de contas não chega, crie no SQL Editor **depois de se cadastrar no app**.
Pegue seu ID em Supabase → Authentication → Users (coluna UID) e substitua abaixo:
```sql
insert into accounts (user_id, name, type, institution, closing_day, due_day, credit_limit)
values
  ('COLE-SEU-UID-AQUI', 'Conta Itaú', 'checking', 'Itaú', null, null, null),
  ('COLE-SEU-UID-AQUI', 'Itaú Mastercard Black', 'credit_card', 'Itaú', 2, 9, 24199),
  ('COLE-SEU-UID-AQUI', 'Nubank', 'credit_card', 'Nubank', 11, 19, 13450),
  ('COLE-SEU-UID-AQUI', 'Conta Inter', 'checking', 'Banco Inter', null, null, null);
```

## Deploy na Vercel
1. Suba o repositório para o GitHub e importe na Vercel.
2. Configure as variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Em Supabase → Authentication → URL Configuration, adicione a URL da Vercel em *Site URL / Redirect URLs*.

## Testar os parsers sem subir o app
`npx tsx test-parsers.ts` — roda os 4 parsers contra os textos reais em `fixtures/`.
