-- Adds the two specialties introduced by the eight-item catalog and normalizes
-- the Portuguese names already displayed by mobile/admin.

insert into public.legal_specialties (slug, name)
values
  ('civil', 'Direito Civil'),
  ('trabalhista', 'Direito Trabalhista'),
  ('familia', 'Direito de Família'),
  ('previdenciario', 'Direito Previdenciário'),
  ('criminal', 'Direito Criminal'),
  ('consumidor', 'Direito do Consumidor'),
  ('empresarial', 'Direito Empresarial'),
  ('tributario', 'Direito Tributário')
on conflict (slug) do update
set name = excluded.name,
    active = true;
