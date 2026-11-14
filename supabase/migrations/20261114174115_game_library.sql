-- Shared official Steam metadata. Writes only through the validating server.
create table public.jvf_game_library (
  id text primary key check (id ~ '^[1-9][0-9]{0,9}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id and data->>'external' = 'true' and data->>'uncertain' = 'true'),
  created_at timestamptz not null default now()
);
alter table public.jvf_game_library enable row level security;
revoke all on public.jvf_game_library from public, anon, authenticated;
grant select, insert on public.jvf_game_library to service_role;
