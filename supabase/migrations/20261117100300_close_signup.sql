-- Nobody can sign themselves up. The only accounts are the ones the sign in
-- function creates for members, which all use the private address below.
create function public.refuse_open_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or new.email not like '%@members.victory.invalid' then
    raise exception 'Sign up is closed.';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_open_signup() from public, anon, authenticated;

create trigger refuse_open_signup before insert on auth.users
  for each row execute function public.refuse_open_signup();
