create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  component text not null,
  device_label text not null,
  status text not null check (status in ('healthy','warning','critical','info')),
  metrics jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index device_events_device_occurred_idx
  on public.device_events(device_id, occurred_at desc);

grant select on public.device_events to authenticated;
grant all on public.device_events to service_role;

alter table public.device_events enable row level security;

create policy "Users read events for own devices"
on public.device_events
for select
to authenticated
using (
  exists (
    select 1 from public.devices d
    where d.id = device_events.device_id
      and d.user_id = auth.uid()
  )
);