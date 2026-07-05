-- 004: recorrências gerenciáveis (listar, período de vigência, inativar)
create table if not exists recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('expense','income')),
  description text not null,
  amount numeric not null check (amount > 0),
  category_id uuid references categories(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  day_of_month int not null check (day_of_month between 1 and 31),
  start_date date not null default current_date,
  end_date date,
  months_ahead int not null default 3 check (months_ahead between 1 and 24),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vincula cada previsão gerada à sua recorrência (para inativar/regerar com precisão)
alter table transactions add column if not exists recurrence_id uuid references recurrences(id) on delete set null;

-- Autenticação está desativada no sistema (migration 002): mesma política aqui.
-- Quando reativar a auth, criar as policies de RLS desta tabela junto.
alter table recurrences disable row level security;
