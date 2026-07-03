-- ============================================================
-- MODO SEM AUTENTICAÇÃO (temporário)
-- Desliga a segurança por usuário (RLS) para o app funcionar sem login.
-- Quando a autenticação voltar, reative com os comandos comentados no fim.
-- ============================================================
alter table public.accounts             disable row level security;
alter table public.categories           disable row level security;
alter table public.documents            disable row level security;
alter table public.credit_card_invoices disable row level security;
alter table public.installment_groups   disable row level security;
alter table public.recurring_rules      disable row level security;
alter table public.transactions         disable row level security;
alter table public.import_batches       disable row level security;
alter table public.categorization_rules disable row level security;
alter table public.audit_items          disable row level security;

-- Storage: permite salvar/ler PDFs sem sessão
drop policy if exists "docs_anon_all" on storage.objects;
create policy "docs_anon_all" on storage.objects
  for all using (bucket_id = 'documents') with check (bucket_id = 'documents');

-- PARA REATIVAR NO FUTURO (não rodar agora):
-- alter table public.accounts enable row level security;  -- e repetir para as demais tabelas
-- drop policy "docs_anon_all" on storage.objects;
