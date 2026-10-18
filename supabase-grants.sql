-- One paste. Supabase → SQL Editor → Run.
-- Fixes "permission denied for table posts" (and profiles, replies, votes)
-- and creates the waitlist table if it is missing.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  position int not null,
  referral_code text unique not null,
  referred_by text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

grant usage on schema public to anon, authenticated, service_role;

grant select on table public.profiles to anon, authenticated;
grant insert, update on table public.profiles to authenticated;

grant select on table public.posts to anon, authenticated;
grant insert on table public.posts to authenticated;

grant select on table public.replies to anon, authenticated;
grant insert on table public.replies to authenticated;

grant select on table public.post_votes to anon, authenticated;
grant insert, update, delete on table public.post_votes to authenticated;

grant select, insert on table public.waitlist to anon, authenticated;
grant update on table public.waitlist to authenticated;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Policies (safe to re-run)
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.replies enable row level security;
alter table public.post_votes enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists "Public read posts" on public.posts;
create policy "Public read posts" on public.posts for select to anon, authenticated using (true);

drop policy if exists "Auth insert posts" on public.posts;
create policy "Auth insert posts" on public.posts for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "Public read replies" on public.replies;
create policy "Public read replies" on public.replies for select to anon, authenticated using (true);

drop policy if exists "Auth insert replies" on public.replies;
create policy "Auth insert replies" on public.replies for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "Public read votes" on public.post_votes;
create policy "Public read votes" on public.post_votes for select to anon, authenticated using (true);

drop policy if exists "Auth insert votes" on public.post_votes;
create policy "Auth insert votes" on public.post_votes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Auth update votes" on public.post_votes;
create policy "Auth update votes" on public.post_votes for update to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Auth delete votes" on public.post_votes;
create policy "Auth delete votes" on public.post_votes for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Public read profiles" on public.profiles;
create policy "Public read profiles" on public.profiles for select to anon, authenticated using (true);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Public read waitlist" on public.waitlist;
create policy "Public read waitlist" on public.waitlist for select to anon, authenticated using (true);

drop policy if exists "Public insert waitlist" on public.waitlist;
create policy "Public insert waitlist" on public.waitlist for insert to anon, authenticated
  with check (true);

-- Make sure a profile exists the moment someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, referral_code, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    lower(new.email) = 'founder@stoneforge.app'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

update public.profiles set is_admin = true where lower(email) = 'founder@stoneforge.app';

-- Referrals: the new member can't update someone else's row under RLS.
create or replace function public.bump_referral(code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if code is null or length(trim(code)) = 0 then
    return;
  end if;
  update public.waitlist
  set position = greatest(1, position - 1)
  where referral_code = trim(code);
end;
$$;

grant execute on function public.bump_referral(text) to anon, authenticated;

-- Only the founder email can hold is_admin.
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

drop trigger if exists profiles_lock_admin on public.profiles;
create trigger profiles_lock_admin
  before insert or update on public.profiles
  for each row execute procedure public.lock_admin_flag();
