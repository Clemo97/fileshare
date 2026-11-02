-- Account deletion for the mobile app.
--
-- Apple's App Review Guideline 5.1.1(v) requires every app that creates accounts, including
-- accounts it creates automatically for the user (this app signs people in anonymously), to
-- let them delete the account inside the app. A phone cannot hold the service-role key that
-- supabase.auth.admin.deleteUser() needs, so the deletion is a function that runs with its
-- owner's rights and only ever touches the caller's own rows.
--
-- public.users has no foreign key to auth.users (see HANDOFF.md, G17), so both rows are
-- deleted here. Deleting the public.users row cascades to everything that belongs to the
-- user: connections, pairing codes and attempts, file sharing requests and their responses,
-- and WebRTC signals. Deleting the auth.users row removes the user's sessions and identities.
--
-- Calling it again after the account is gone does nothing, so a retry is harmless.

create function delete_my_account() returns void as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.users where id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$ language plpgsql security definer set search_path = public;

-- Signed-in users only. Anonymous sign-ins use the authenticated role.
revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
