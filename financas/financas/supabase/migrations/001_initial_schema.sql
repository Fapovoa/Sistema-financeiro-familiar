-- ============================================================
-- Finanças Familiares — Schema inicial (Supabase / PostgreSQL)
-- ============================================================
create extension if not exists pg_trgm;

-- ---------- CONTAS E CARTÕES ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking','savings','credit_card','cash','investment')),
  institution text,
  last_four_digits text,
  closing_day int check (closing_day between 1 and 31),
  due_day int check (due_day between 1 and 31),
  credit_limit numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CATEGORIAS ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('expense','income')),
  color text,
  icon text,
  parent_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name, type)
);

-- ---------- DOCUMENTOS (PDFs) ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  file_name text not null,
  file_url text,
  document_type text not null check (document_type in ('bank_statement','credit_card_statement')),
  institution text,
  reference_month date,
  file_hash text not null,
  import_status text not null default 'pending'
    check (import_status in ('pending','previewed','imported','failed','reprocessed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, file_hash)          -- mesmo PDF nunca importa 2x
);

-- ---------- FATURAS DE CARTÃO ----------
create table public.credit_card_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  reference_month date not null,       -- competência (1º dia do mês)
  closing_date date,
  due_date date not null,
  total_amount numeric(14,2) not null default 0,
  status text not null default 'open'
    check (status in ('open','closed','paid','overdue','forecast')),
  payment_transaction_id uuid,
  cash_flow_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, reference_month)
);

-- ---------- GRUPOS DE PARCELAMENTO ----------
create table public.installment_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  description_base text not null,
  merchant_name text,
  total_installments int not null,
  first_installment_date date,
  amount_per_installment numeric(14,2),
  total_amount numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- REGRAS DE RECORRÊNCIA ----------
create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  description_pattern text not null,
  merchant_name text,
  category_id uuid references public.categories(id) on delete set null,
  expected_amount numeric(14,2),
  frequency text not null default 'monthly'
    check (frequency in ('weekly','biweekly','monthly','yearly','custom')),
  expected_day int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- LANÇAMENTOS ----------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  installment_group_id uuid references public.installment_groups(id) on delete set null,
  recurring_rule_id uuid references public.recurring_rules(id) on delete set null,
  type text not null check (type in
    ('expense','income','transfer','credit_card_payment','refund','ignored')),
  description_original text not null,
  description_clean text,
  amount numeric(14,2) not null,              -- negativo = saída
  transaction_date date not null,
  due_date date,
  payment_date date,
  competence_month date,
  status text not null default 'paid'
    check (status in ('paid','pending','forecast','confirmed','ignored')),
  source text not null default 'pdf_import'
    check (source in ('pdf_import','manual','recurrence','installment_forecast','invoice_total')),
  is_recurring boolean not null default false,
  is_installment boolean not null default false,
  installment_number int,
  installment_total int,
  is_card_purchase boolean not null default false,
  affects_cash_flow boolean not null default true,
  affects_category_report boolean not null default true,
  duplicate_hash text,
  confidence_score numeric(4,3),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tx_user_date on public.transactions (user_id, transaction_date);
create index idx_tx_user_hash on public.transactions (user_id, duplicate_hash);
create index idx_tx_invoice on public.transactions (invoice_id);
create index idx_tx_desc_trgm on public.transactions using gin (description_clean gin_trgm_ops);

alter table public.credit_card_invoices
  add constraint fk_invoice_payment_tx
  foreign key (payment_transaction_id) references public.transactions(id) on delete set null;
alter table public.credit_card_invoices
  add constraint fk_invoice_cashflow_tx
  foreign key (cash_flow_transaction_id) references public.transactions(id) on delete set null;

-- ---------- LOTES DE IMPORTAÇÃO ----------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  status text not null default 'done',
  total_transactions_found int default 0,
  total_imported int default 0,
  total_duplicates int default 0,
  total_audit int default 0,
  created_at timestamptz not null default now()
);

-- ---------- REGRAS DE CATEGORIZAÇÃO (aprendizado) ----------
create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern text not null,
  normalized_pattern text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  confidence numeric(4,3) not null default 1.0,
  created_from_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_pattern)
);
create index idx_catrule_trgm on public.categorization_rules
  using gin (normalized_pattern gin_trgm_ops);

-- ---------- AUDITORIA ----------
create table public.audit_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','resolved','ignored')),
  suggested_category_id uuid references public.categories(id) on delete set null,
  confidence_score numeric(4,3),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------- BUSCA DE DUPLICADOS (fuzzy, usada pela prévia) ----------
create or replace function public.find_possible_duplicates(
  p_user uuid, p_amount numeric, p_date date, p_desc text, p_days int default 4
) returns setof public.transactions
language sql stable security invoker as $fn$
  select t.* from public.transactions t
  where t.user_id = p_user
    and t.amount = p_amount
    and t.transaction_date between p_date - p_days and p_date + p_days
    and (
      t.duplicate_hash = md5(p_user::text || p_date::text || p_amount::text || lower(p_desc))
      or similarity(coalesce(t.description_clean,''), p_desc) > 0.55
    );
$fn$;

-- ---------- RLS ----------
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.documents enable row level security;
alter table public.credit_card_invoices enable row level security;
alter table public.installment_groups enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.transactions enable row level security;
alter table public.import_batches enable row level security;
alter table public.categorization_rules enable row level security;
alter table public.audit_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','documents','credit_card_invoices',
    'installment_groups','recurring_rules','transactions','import_batches',
    'categorization_rules','audit_items']
  loop
    execute format(
      'create policy "%1$s_owner_all" on public.%1$s
         for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
  end loop;
end $$;

-- ---------- STORAGE (bucket privado para PDFs) ----------
insert into storage.buckets (id, name, public) values ('documents','documents', false)
on conflict (id) do nothing;

create policy "docs_owner_select" on storage.objects for select
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_owner_insert" on storage.objects for insert
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_owner_delete" on storage.objects for delete
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- CATEGORIAS PADRÃO AO CRIAR USUÁRIO ----------
create or replace function public.seed_default_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories (user_id, name, type, color) values
    (new.id,'Moradia','expense','#6366F1'),(new.id,'Mercado','expense','#22C55E'),
    (new.id,'Comer fora','expense','#F97316'),(new.id,'Saúde','expense','#EF4444'),
    (new.id,'Educação','expense','#8B5CF6'),(new.id,'Transporte','expense','#0EA5E9'),
    (new.id,'Combustível','expense','#F59E0B'),(new.id,'Carro','expense','#64748B'),
    (new.id,'Lazer','expense','#EC4899'),(new.id,'Viagens','expense','#14B8A6'),
    (new.id,'Assinaturas','expense','#A855F7'),(new.id,'Serviços','expense','#78716C'),
    (new.id,'Compras','expense','#3B82F6'),(new.id,'Vestuário','expense','#D946EF'),
    (new.id,'Casa','expense','#84CC16'),(new.id,'Filhos','expense','#FB7185'),
    (new.id,'Pets','expense','#FBBF24'),(new.id,'Impostos','expense','#991B1B'),
    (new.id,'Tarifas bancárias','expense','#475569'),(new.id,'Cartão de crédito','expense','#4A6CF7'),
    (new.id,'Investimentos','expense','#059669'),(new.id,'Transferências','expense','#94A3B8'),
    (new.id,'Outros','expense','#9CA3AF'),(new.id,'Não categorizado','expense','#CBD5E1'),
    (new.id,'Salário','income','#16A34A'),(new.id,'Pró-labore','income','#22C55E'),
    (new.id,'Aluguel recebido','income','#0EA5E9'),(new.id,'Reembolso','income','#F59E0B'),
    (new.id,'Rendimentos','income','#059669'),(new.id,'Venda','income','#8B5CF6'),
    (new.id,'Outros','income','#9CA3AF');
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.seed_default_categories();
