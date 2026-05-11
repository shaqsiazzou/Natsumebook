-- Natsumebook Supabase bootstrap.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query.

create extension if not exists pgcrypto;

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  season_number smallint not null check (season_number between 1 and 99),
  episode_number smallint not null check (episode_number between 1 and 99),
  title text not null,
  name text not null default '',
  image_url text not null default '',
  thumbnail_url text not null default '',
  image_path text,
  thumbnail_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_number, episode_number)
);

create index if not exists episodes_catalog_order_idx
  on public.episodes (season_number, episode_number);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_episodes_updated_at on public.episodes;
create trigger set_episodes_updated_at
before update on public.episodes
for each row
execute function public.set_updated_at();

alter table public.episodes enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'episodes'
      and policyname = 'Episodes are publicly readable'
  ) then
    create policy "Episodes are publicly readable"
      on public.episodes
      for select
      using (true);
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'monster-images',
  'monster-images',
  true,
  31457280,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Monster images are publicly readable'
  ) then
    create policy "Monster images are publicly readable"
      on storage.objects
      for select
      using (bucket_id = 'monster-images');
  end if;
end;
$$;

with season_counts(season_number, episode_count) as (
  values
    (1, 13),
    (2, 13),
    (3, 13),
    (4, 13),
    (5, 11),
    (6, 11),
    (7, 12)
),
seed_episodes as (
  select
    season_number,
    generate_series(1, episode_count)::smallint as episode_number
  from season_counts
)
insert into public.episodes (
  season_number,
  episode_number,
  title,
  name,
  image_url,
  thumbnail_url
)
select
  season_number,
  episode_number,
  case
    when season_number = 1 and episode_number = 1 then '第 1 集 菱垣'
    else format('第 %s 季 第 %s 集', season_number, episode_number)
  end,
  case
    when season_number = 1 and episode_number = 1 then 'ひしがき'
    else ''
  end,
  case
    when season_number = 1 and episode_number = 1
      then 'assets/images/monsters/season-01/episode-01.webp?v=1778341756280'
    else 'assets/images/monsters/placeholder.png'
  end,
  case
    when season_number = 1 and episode_number = 1
      then 'assets/images/monsters/thumbs/season-01/episode-01.webp?v=1778341756280'
    else 'assets/images/monsters/thumbs/placeholder.webp'
  end
from seed_episodes
on conflict (season_number, episode_number) do nothing;
