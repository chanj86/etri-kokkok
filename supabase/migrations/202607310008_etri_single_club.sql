insert into public.clubs (
  name,
  code_normalized,
  join_code_hash
)
values (
  'ETRI 콕콕',
  'ETRI',
  extensions.crypt('ETRI-INTERNAL', extensions.gen_salt('bf'))
)
on conflict (code_normalized)
do update set name = excluded.name;
