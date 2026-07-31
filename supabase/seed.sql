insert into public.clubs (
  name,
  code_normalized,
  join_code_hash
)
values (
  '콕콕 배드민턴',
  'KOKKOK24',
  extensions.crypt('KOKKOK24', extensions.gen_salt('bf'))
)
on conflict (code_normalized) do nothing;
