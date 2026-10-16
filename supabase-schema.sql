-- Run this in Supabase → SQL Editor when you're ready for real logins.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  name text not null,
  is_admin boolean not null default false,
  waitlist_position int,
  referral_code text unique,
  created_at timestamptz not null default now()
);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete set null,
  author_name text not null,
  type text not null check (type in ('tip', 'question')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists post_votes (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  primary key (post_id, user_id)
);

create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  author_name text not null,
  body text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table posts enable row level security;
alter table post_votes enable row level security;
alter table replies enable row level security;

create policy "Public read posts" on posts for select using (true);
create policy "Auth insert posts" on posts for insert with check (auth.uid() = author_id);
create policy "Public read replies" on replies for select using (true);
create policy "Auth insert replies" on replies for insert with check (auth.uid() = author_id);
create policy "Public read votes" on post_votes for select using (true);
create policy "Auth upsert votes" on post_votes for all using (auth.uid() = user_id);
