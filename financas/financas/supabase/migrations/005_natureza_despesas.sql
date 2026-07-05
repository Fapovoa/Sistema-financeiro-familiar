-- 005: natureza das despesas (fixa × variável) na categoria
alter table categories
  add column if not exists nature text not null default 'undefined'
  check (nature in ('fixed','variable','undefined'));

-- Pré-classificação inteligente por nome (só despesas ainda "sem definir").
-- Você reajusta o que quiser na tela Categorias.

-- FIXAS: recorrentes e previsíveis
update categories set nature = 'fixed'
where type = 'expense' and nature = 'undefined' and (
  name ilike '%alugu%' or name ilike '%moradia%' or name ilike '%condom%' or
  name ilike '%financiam%' or name ilike '%emprést%' or name ilike '%emprest%' or
  name ilike '%consórc%' or name ilike '%consorc%' or
  name ilike '%internet%' or name ilike '%telefon%' or name ilike '%celular%' or
  name ilike '%streaming%' or name ilike '%assinatura%' or
  name ilike '%seguro%' or name ilike '%plano de saúde%' or name ilike '%plano de saude%' or
  name ilike '%mensalidade%' or name ilike '%escola%' or name ilike '%faculdade%' or
  name ilike '%educaç%' or name ilike '%educac%' or name ilike '%curso%' or
  name ilike '%academia%' or
  name ilike '%energia%' or name ilike '%luz%' or name ilike '%água%' or name ilike '%agua%' or
  name ilike '%gás%' or name ilike '%gas%' or
  name ilike '%iptu%' or name ilike '%ipva%'
);

-- VARIÁVEIS: oscilam mês a mês
update categories set nature = 'variable'
where type = 'expense' and nature = 'undefined' and (
  name ilike '%aliment%' or name ilike '%mercado%' or name ilike '%superm%' or
  name ilike '%restaurante%' or name ilike '%delivery%' or name ilike '%lanch%' or
  name ilike '%lazer%' or name ilike '%viag%' or name ilike '%diver%' or
  name ilike '%transporte%' or name ilike '%combust%' or name ilike '%uber%' or
  name ilike '%compra%' or name ilike '%vestuár%' or name ilike '%vestuar%' or name ilike '%roupa%' or
  name ilike '%presente%' or name ilike '%farmác%' or name ilike '%farmac%' or
  name ilike '%pet%' or name ilike '%beleza%'
);
