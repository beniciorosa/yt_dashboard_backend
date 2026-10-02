-- Registro de cada execução de sincronização (cron ou manual), para a UI mostrar
-- "última sincronização" e o motivo quando falha. Só o backend (service_role) acessa.
create table if not exists public.sync_runs (
    id bigint generated always as identity primary key,
    job text not null,
    status text not null check (status in ('running', 'success', 'partial', 'error')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    summary jsonb,
    error text
);

create index if not exists sync_runs_job_started_idx on public.sync_runs (job, started_at desc);

alter table public.sync_runs enable row level security;
