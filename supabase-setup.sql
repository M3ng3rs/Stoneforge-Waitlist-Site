-- Run this AFTER supabase-schema.sql (SQL Editor → Run)
-- Adds auto profile creation, waitlist table, and tighter policies.

-- Auto-create profile when someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, referral_code, waitlist_position)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Waitlist emails (public insert for join form)
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  position int not null,
  referral_code text unique not null,
  referred_by text,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table waitlist enable row level security;

drop policy if exists "Public read waitlist own-ish" on waitlist;
create policy "Public read waitlist" on waitlist for select using (true);
drop policy if exists "Public insert waitlist" on waitlist;
create policy "Public insert waitlist" on waitlist for insert with check (true);

-- Profiles policies
drop policy if exists "Public read profiles" on profiles;
create policy "Public read profiles" on profiles for select using (true);
drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile" on profiles for update using (auth.uid() = id);

-- Votes: split policies (clearer than FOR ALL)
drop policy if exists "Auth upsert votes" on post_votes;
create policy "Auth insert votes" on post_votes for insert with check (auth.uid() = user_id);
create policy "Auth update votes" on post_votes for update using (auth.uid() = user_id);
create policy "Auth delete votes" on post_votes for delete using (auth.uid() = user_id);

-- Founder admin (create the Auth user first, or sign in once on the site)
update profiles set is_admin = true where lower(email) = 'founder@stoneforge.app';

-- Members can create their own profile if the signup trigger didn't
drop policy if exists "Users insert own profile" on profiles;
create policy "Users insert own profile" on profiles for insert with check (auth.uid() = id);

-- Only the founder email can hold is_admin. Everyone else keeps the old flag.
create or replace function public.lock_admin_flag()
returns trigger
language plpgsql
as $$
begin
  if lower(coalesce(new.email, '')) = 'founder@stoneforge.app' then
    new.is_admin := true;
  elsif tg_op = 'UPDATE' then
    new.is_admin := old.is_admin;
  else
    new.is_admin := false;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_admin on profiles;
create trigger profiles_lock_admin
  before insert or update on profiles
  for each row execute procedure public.lock_admin_flag();
