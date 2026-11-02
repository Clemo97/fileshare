-- Pairing codes without the service-role key.
--
-- The web app creates and redeems pairing codes in Next.js server actions that use the
-- service-role key (modules/connections/create/actions.ts). A native app can never hold that
-- key, so the same two steps live here as functions. They run with their owner's rights and
-- check auth.uid() themselves. The web app does not call them yet.
--
-- Differences from the server actions:
--   * codes come from gen_random_uuid() (a CSPRNG) instead of Math.random()
--   * a user can make at most 5 wrong guesses per 10 minutes
--   * a code can be redeemed once, and not by the user who created it
--   * redeeming also creates the user_connections row (code creator = user_1_id), so both
--     devices see the connection even if the creator's app is in the background. The web app
--     creates that row itself after the WebRTC handshake.

create table pairing_attempts (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete cascade not null,
  created_at timestamp with time zone default now() not null
);

create index pairing_attempts_user_id_created_at
on pairing_attempts (user_id, created_at);

-- No policies: the table is only reached through redeem_pairing_code().
alter table pairing_attempts enable row level security;

-- Returns {"code": "1234", "created_at": "..."}
create function create_pairing_code() returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_created_at timestamp with time zone;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- The code is the primary key and only has 10,000 values, so free the ones that can
  -- no longer be redeemed.
  delete from pairing_codes where created_at < now() - interval '5 minutes';
  delete from pairing_codes where user_id = v_user_id;

  for i in 1..20 loop
    v_code := lpad(
      (abs(('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 10000)::text,
      4,
      '0'
    );

    begin
      insert into pairing_codes (code, user_id)
      values (v_code, v_user_id)
      returning created_at into v_created_at;
    exception when unique_violation then
      continue;
    end;

    return jsonb_build_object('code', v_code, 'created_at', v_created_at);
  end loop;

  raise exception 'no_code_available';
end;
$$ language plpgsql security definer set search_path = public;

-- Returns the user id of the code's creator, or null if the code is wrong, expired, already
-- used or your own. It returns null instead of raising so that the failed attempt is kept
-- (an exception would roll the insert into pairing_attempts back).
create function redeem_pairing_code(p_code text) returns uuid as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if (
    select count(*)
    from pairing_attempts
    where user_id = v_user_id
    and created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'too_many_attempts';
  end if;

  select pairing_codes.user_id into v_owner_id
  from pairing_codes
  where pairing_codes.code = p_code
  and pairing_codes.created_at >= now() - interval '5 minutes'
  and pairing_codes.user_id <> v_user_id
  and not exists (
    select 1
    from pairing_code_redemptions
    where pairing_code_redemptions.pairing_code = pairing_codes.code
  );

  if v_owner_id is null then
    insert into pairing_attempts (user_id) values (v_user_id);
    return null;
  end if;

  insert into pairing_code_redemptions (pairing_code, user_id)
  values (p_code, v_user_id);

  if not exists (
    select 1
    from user_connections
    where (user_1_id = v_owner_id and user_2_id = v_user_id)
    or (user_1_id = v_user_id and user_2_id = v_owner_id)
  ) then
    insert into user_connections (user_1_id, user_2_id)
    values (v_owner_id, v_user_id);
  end if;

  return v_owner_id;
end;
$$ language plpgsql security definer set search_path = public;

-- Signed-in users only. Anonymous sign-ins use the authenticated role.
revoke execute on function create_pairing_code() from public, anon;
revoke execute on function redeem_pairing_code(text) from public, anon;
grant execute on function create_pairing_code() to authenticated;
grant execute on function redeem_pairing_code(text) to authenticated;
