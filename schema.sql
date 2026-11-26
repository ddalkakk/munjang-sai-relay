create table public.relay_rooms (
  id uuid primary key,
  rev integer not null,
  story jsonb not null
);
alter table public.relay_rooms enable row level security;
revoke all on public.relay_rooms from public, anon, authenticated;
grant select, insert, update on public.relay_rooms to service_role;
