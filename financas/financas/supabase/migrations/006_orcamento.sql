-- 006: orçamento por categoria (valor alvo mensal, um por categoria)
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category_id uuid not null references categories(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);

-- Autenticação está desativada no sistema (migration 002): mesma política aqui.
-- Ao reativar a auth, criar as policies de RLS desta tabela junto.
alter table budgets disable row level security;
