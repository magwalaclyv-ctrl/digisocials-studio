create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('meta', 'linkedin')),
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin')),
  platform_account_id text not null,
  display_name text not null,
  username text,
  connected_at timestamptz not null default now(),
  unique (workspace_id, platform, platform_account_id),
  unique (id, workspace_id),
  constraint social_accounts_owner_workspace_fkey
    foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);

create table if not exists public.social_account_credentials (
  account_id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint credentials_account_workspace_fkey
    foreign key (account_id, workspace_id) references public.social_accounts(id, workspace_id) on delete cascade,
  constraint credentials_owner_workspace_fkey
    foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 3000),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  account_ids uuid[] not null default '{}',
  media_url text,
  publish_results jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_at is not null),
  check (media_url is null or (media_url ~* '^https?://[^[:space:]]+$' and char_length(media_url) <= 2048)),
  constraint posts_owner_workspace_fkey
    foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);

create table if not exists public.provider_oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('meta', 'linkedin')),
  state_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint oauth_states_owner_workspace_fkey
    foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);

create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null,
  external_post_id text not null,
  metric_date date not null default current_date,
  likes bigint not null default 0 check (likes >= 0),
  comments bigint not null default 0 check (comments >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  collected_at timestamptz not null default now(),
  constraint analytics_owner_workspace_fkey
    foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade,
  constraint analytics_account_workspace_fkey
    foreign key (account_id, workspace_id) references public.social_accounts(id, workspace_id) on delete cascade,
  unique (account_id, external_post_id, metric_date)
);

create index if not exists posts_workspace_created_idx on public.posts (workspace_id, created_at desc);
create index if not exists posts_due_schedule_idx on public.posts (scheduled_at) where status = 'scheduled';
create index if not exists accounts_workspace_idx on public.social_accounts (workspace_id, connected_at);
create index if not exists analytics_workspace_idx on public.analytics_snapshots (workspace_id, metric_date desc);
create index if not exists oauth_states_expiry_idx on public.provider_oauth_states (expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_account_credentials enable row level security;
alter table public.posts enable row level security;
alter table public.provider_oauth_states enable row level security;
alter table public.analytics_snapshots enable row level security;

drop policy if exists "Workspace owner can read own workspace" on public.workspaces;
create policy "Workspace owner can read own workspace" on public.workspaces
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Workspace owner can create own workspace" on public.workspaces;
create policy "Workspace owner can create own workspace" on public.workspaces
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Workspace owner can update own workspace" on public.workspaces;
create policy "Workspace owner can update own workspace" on public.workspaces
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "Account owner can read own social accounts" on public.social_accounts;
create policy "Account owner can read own social accounts" on public.social_accounts
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Account owner can delete own social accounts" on public.social_accounts;
create policy "Account owner can delete own social accounts" on public.social_accounts
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Provider credentials are private server data. The browser can never query this table.
revoke all on public.social_account_credentials from anon, authenticated;
grant all on public.social_account_credentials to service_role;
revoke all on public.provider_oauth_states from anon, authenticated;
grant all on public.provider_oauth_states to service_role;

drop policy if exists "Post owner can read own posts" on public.posts;
create policy "Post owner can read own posts" on public.posts
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Post owner can create own posts" on public.posts;
create policy "Post owner can create own posts" on public.posts
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Post owner can update own posts" on public.posts;
create policy "Post owner can update own posts" on public.posts
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Post owner can delete own posts" on public.posts;
create policy "Post owner can delete own posts" on public.posts
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "Analytics owner can read own metrics" on public.analytics_snapshots;
create policy "Analytics owner can read own metrics" on public.analytics_snapshots
  for select to authenticated using (owner_id = (select auth.uid()));

-- OAuth state and provider tokens are accessed only by the API's service-role client.
