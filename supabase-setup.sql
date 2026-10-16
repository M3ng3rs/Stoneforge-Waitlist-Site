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

-- After you create your admin Auth user in Supabase, run (change email):
-- update profiles set is_admin = true where email = 'admin@stoneforge.com';
