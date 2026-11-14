begin;
create table if not exists public.jvf_profiles (
  id uuid primary key default gen_random_uuid(),
  steam_id text not null unique check(steam_id ~ '^[0-9]{17}$'),
  name text not null check(char_length(name) between 1 and 30),
  avatar text not null default '',
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);
create table if not exists public.jvf_account_sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  profile_id uuid not null references public.jvf_profiles(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '30 days',
  created_at timestamptz not null default now()
);
create index if not exists jvf_account_sessions_profile on public.jvf_account_sessions(profile_id);
create table if not exists public.jvf_steam_nonces (
  nonce_hash text primary key,
  created_at timestamptz not null default now()
);
create table if not exists public.jvf_preferences (
  profile_id uuid not null references public.jvf_profiles(id) on delete cascade,
  game_id text not null check(char_length(game_id) between 1 and 40),
  vote text not null check(vote in ('yes','super','no')),
  updated_at timestamptz not null default now(),
  primary key(profile_id,game_id)
);
alter table public.jvf_members add column if not exists profile_id uuid references public.jvf_profiles(id);
create unique index if not exists jvf_members_profile_room on public.jvf_members(room_id,profile_id) where profile_id is not null;
create index if not exists jvf_members_profile on public.jvf_members(profile_id) where profile_id is not null;
create table if not exists public.jvf_invitations (
  room_id uuid not null references public.jvf_rooms(id) on delete cascade,
  steam_id text not null check(steam_id ~ '^[0-9]{17}$'),
  invited_by uuid not null references public.jvf_profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  primary key(room_id,steam_id)
);
create index if not exists jvf_invitations_steam on public.jvf_invitations(steam_id,expires_at);
alter table public.jvf_profiles enable row level security;
alter table public.jvf_account_sessions enable row level security;
alter table public.jvf_steam_nonces enable row level security;
alter table public.jvf_preferences enable row level security;
alter table public.jvf_invitations enable row level security;
revoke all on public.jvf_profiles,public.jvf_account_sessions,public.jvf_steam_nonces,public.jvf_preferences,public.jvf_invitations from public,anon,authenticated;
grant select,insert,update,delete on public.jvf_profiles,public.jvf_account_sessions,public.jvf_steam_nonces,public.jvf_preferences,public.jvf_invitations to service_role;
grant update on public.jvf_members to service_role;

create table if not exists public.jvf_account_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.jvf_profiles(id) on delete cascade,
  action text not null,
  game_id text,
  vote text,
  created_at timestamptz not null default now()
);
create index if not exists jvf_account_events_profile on public.jvf_account_events(profile_id,created_at desc);
alter table public.jvf_account_events enable row level security;
revoke all on public.jvf_account_events from public,anon,authenticated;
grant select,insert on public.jvf_account_events to service_role;
grant usage on sequence public.jvf_account_events_id_seq to service_role;

-- Only the verified OpenID callback on our server can call this function.
create or replace function public.jvf_steam_login(p_steam_id text,p_name text,p_avatar text,p_session_hash text,p_nonce_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_profile uuid;
begin
  if p_steam_id !~ '^[0-9]{17}$' or p_session_hash !~ '^[a-f0-9]{64}$' or p_nonce_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
  begin insert into public.jvf_steam_nonces(nonce_hash) values(p_nonce_hash);
  exception when unique_violation then raise exception 'NONCE_REUSED';end;
  insert into public.jvf_profiles(steam_id,name,avatar) values(p_steam_id,left(p_name,30),coalesce(p_avatar,''))
  on conflict(steam_id) do update set name=excluded.name,avatar=case when excluded.avatar='' then public.jvf_profiles.avatar else excluded.avatar end,last_login_at=now()
  returning id into v_profile;
  insert into public.jvf_account_sessions(token_hash,profile_id) values(p_session_hash,v_profile);
  insert into public.jvf_account_events(profile_id,action) values(v_profile,'login');
  delete from public.jvf_account_sessions where expires_at<now();
  delete from public.jvf_steam_nonces where created_at<now()-interval '1 day';
  return jsonb_build_object('profileId',v_profile);
end;$$;

create or replace function public.jvf_account_command(p_session_hash text,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_profile public.jvf_profiles%rowtype;
  v_member public.jvf_members%rowtype;
  v_item record;
  v_room uuid;
  v_previous text;
begin
  select p.* into v_profile from public.jvf_profiles p join public.jvf_account_sessions s on s.profile_id=p.id where s.token_hash=p_session_hash and s.expires_at>now();
  if not found then raise exception 'LOGIN_REQUIRED';end if;
  if p_action='logout' then
    insert into public.jvf_account_events(profile_id,action) values(v_profile.id,'logout');
    delete from public.jvf_account_sessions where token_hash=p_session_hash;
    return jsonb_build_object('ok',true);
  elsif p_action='filters' then
    if jsonb_typeof(p_data->'filters')<>'object' then raise exception 'INVALID_INPUT';end if;
    update public.jvf_profiles set filters=p_data->'filters' where id=v_profile.id returning * into v_profile;
  elsif p_action='vote' then
    if coalesce(p_data->>'vote','') not in ('yes','super','no','clear') or coalesce(p_data->>'game','')='' then raise exception 'INVALID_INPUT';end if;
    if p_data->>'vote'='clear' then delete from public.jvf_preferences where profile_id=v_profile.id and game_id=p_data->>'game';
    else insert into public.jvf_preferences(profile_id,game_id,vote) values(v_profile.id,p_data->>'game',p_data->>'vote') on conflict(profile_id,game_id) do update set vote=excluded.vote,updated_at=now();end if;
  elsif p_action='import' or p_action='link' then
    -- Existing account choices win when importing local data; votes are never discarded.
    if jsonb_typeof(p_data->'preferences')='object' then
      for v_item in select key,value from jsonb_each_text(p_data->'preferences') loop
        if v_item.value in ('yes','super','no') and char_length(v_item.key) between 1 and 40 then
          insert into public.jvf_preferences(profile_id,game_id,vote) values(v_profile.id,v_item.key,v_item.value) on conflict do nothing;
        end if;
      end loop;
    end if;
    if p_action='link' then
      select * into v_member from public.jvf_members where id=(p_data->>'member')::uuid and room_id=(p_data->>'room')::uuid and token_hash=p_data->>'tokenHash' for update;
      if not found then raise exception 'ACCESS_DENIED';end if;
      if v_member.profile_id is not null and v_member.profile_id<>v_profile.id then raise exception 'ACCOUNT_ALREADY_LINKED';end if;
      if exists(select 1 from public.jvf_members where room_id=v_member.room_id and profile_id=v_profile.id and id<>v_member.id) then raise exception 'ACCOUNT_ALREADY_LINKED';end if;
      update public.jvf_members set profile_id=v_profile.id where id=v_member.id;
      insert into public.jvf_preferences(profile_id,game_id,vote,updated_at) select v_profile.id,game_id,vote,updated_at from public.jvf_votes where room_id=v_member.room_id and member_id=v_member.id on conflict do nothing;
      insert into public.jvf_votes(room_id,member_id,game_id,vote) select v_member.room_id,v_member.id,game_id,vote from public.jvf_preferences where profile_id=v_profile.id on conflict do nothing;
    end if;
  elsif p_action='invite' then
    v_room=(p_data->>'room')::uuid;
    if not exists(select 1 from public.jvf_members where room_id=v_room and profile_id=v_profile.id) then raise exception 'ACCESS_DENIED';end if;
    if jsonb_array_length(p_data->'steamIds')>4 then raise exception 'INVALID_INPUT';end if;
    for v_item in select value from jsonb_array_elements_text(p_data->'steamIds') loop
      insert into public.jvf_invitations(room_id,steam_id,invited_by) values(v_room,v_item.value,v_profile.id)
      on conflict(room_id,steam_id) do update set expires_at=now()+interval '7 days',invited_by=excluded.invited_by;
    end loop;
  elsif p_action<>'state' then raise exception 'INVALID_INPUT';
  end if;
  if p_action<>'state' then insert into public.jvf_account_events(profile_id,action,game_id,vote) values(v_profile.id,p_action,p_data->>'game',p_data->>'vote');end if;
  return jsonb_build_object(
    'profile',jsonb_build_object('id',v_profile.id,'steamId',v_profile.steam_id,'name',v_profile.name,'avatar',v_profile.avatar),
    'preferences',coalesce((select jsonb_object_agg(game_id,vote) from public.jvf_preferences where profile_id=v_profile.id),'{}'::jsonb),
    'filters',v_profile.filters,
    'rooms',coalesce((select jsonb_agg(jsonb_build_object('room',m.room_id,'member',m.id,'name',m.name,'members',(select count(*) from public.jvf_members p where p.room_id=m.room_id)) order by r.created_at desc) from public.jvf_members m join public.jvf_rooms r on r.id=m.room_id where m.profile_id=v_profile.id),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('room',i.room_id,'from',p.name,'members',(select count(*) from public.jvf_members m where m.room_id=i.room_id))) from public.jvf_invitations i join public.jvf_profiles p on p.id=i.invited_by where i.steam_id=v_profile.steam_id and i.expires_at>now() and not exists(select 1 from public.jvf_members m where m.room_id=i.room_id and m.profile_id=v_profile.id)),'[]'::jsonb)
  );
end;$$;

create or replace function public.jvf_account_room(p_session_hash text,p_action text,p_room uuid,p_member uuid,p_token_hash text,p_name text default '',p_game text default null,p_vote text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_profile uuid; v_member public.jvf_members%rowtype;v_result jsonb;v_name text;
begin
  select profile_id into v_profile from public.jvf_account_sessions where token_hash=p_session_hash and expires_at>now();
  if not found then raise exception 'LOGIN_REQUIRED';end if;
  perform pg_catalog.set_config('jvf.account_profile',v_profile::text,true);
  if p_action='join' then perform 1 from public.jvf_rooms where id=p_room for update;end if;
  select * into v_member from public.jvf_members where room_id=p_room and profile_id=v_profile;
  if found then p_member=v_member.id;p_token_hash=v_member.token_hash;
  elsif p_action not in ('create','join') then raise exception 'ACCESS_DENIED';end if;
  -- The original command serializes room joins and enforces the five-person limit.
  v_result=public.jvf_command(p_action,p_room,p_member,p_token_hash,p_name,p_game,p_vote);
  update public.jvf_members set profile_id=v_profile where id=p_member and (profile_id is null or profile_id=v_profile);
  if not found then raise exception 'ACCOUNT_ALREADY_LINKED';end if;
  if p_action in ('create','join') then
    insert into public.jvf_votes(room_id,member_id,game_id,vote) select p_room,p_member,game_id,vote from public.jvf_preferences where profile_id=v_profile on conflict do nothing;
    delete from public.jvf_invitations where room_id=p_room and steam_id=(select steam_id from public.jvf_profiles where id=v_profile);
    v_result=public.jvf_command('state',p_room,p_member,p_token_hash,'',null,null);
  elsif p_action='vote' then
    insert into public.jvf_account_events(profile_id,action,game_id,vote) values(v_profile,'vote',p_game,p_vote);
    if p_vote='clear' then delete from public.jvf_preferences where profile_id=v_profile and game_id=p_game;
    else insert into public.jvf_preferences(profile_id,game_id,vote) values(v_profile,p_game,p_vote) on conflict(profile_id,game_id) do update set vote=excluded.vote,updated_at=now();end if;
  end if;
  return v_result;
end;$$;
revoke all on function public.jvf_steam_login(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.jvf_account_command(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.jvf_account_room(text,text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.jvf_steam_login(text,text,text,text,text),public.jvf_account_command(text,text,jsonb),public.jvf_account_room(text,text,uuid,uuid,text,text,text,text) to service_role;
create or replace function public.jvf_command(
  p_action text,p_room uuid,p_member uuid,p_token_hash text,
  p_name text default '',p_game text default null,p_vote text default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_room public.jvf_rooms%rowtype;
  v_member public.jvf_members%rowtype;
  v_count integer;
  v_previous_vote text;
begin
  if p_action not in ('create','join','state','vote') or p_room is null or p_member is null
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INPUT';
  end if;
  if exists(select 1 from public.jvf_members where id=p_member and profile_id is not null and profile_id::text is distinct from nullif(pg_catalog.current_setting('jvf.account_profile',true),'')) then raise exception 'STEAM_LOGIN_REQUIRED';end if;
  if p_action='create' then
    -- A transaction-scoped lock serializes duplicate/retried creates.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_room::text,0));
    select * into v_room from public.jvf_rooms where id=p_room for update;
    if found then
      select * into v_member from public.jvf_members where id=p_member and room_id=p_room and token_hash=p_token_hash;
      if not found then raise exception 'ACCESS_DENIED'; end if;
    else
      if p_name is null or char_length(btrim(p_name)) not between 1 and 30 then raise exception 'INVALID_INPUT'; end if;
      insert into public.jvf_rooms(id) values(p_room);
      insert into public.jvf_members(id,room_id,name,token_hash) values(p_member,p_room,btrim(p_name),p_token_hash);
    end if;
  elsif p_action='join' then
    select * into v_room from public.jvf_rooms where id=p_room for update;
    if not found then raise exception 'ROOM_NOT_FOUND'; end if;
    select * into v_member from public.jvf_members where id=p_member;
    if found then
      if v_member.room_id<>p_room or v_member.token_hash<>p_token_hash then raise exception 'ACCESS_DENIED'; end if;
    else
      if p_name is null or char_length(btrim(p_name)) not between 1 and 30 then raise exception 'INVALID_INPUT'; end if;
      select count(*) into v_count from public.jvf_members where room_id=p_room;
      if v_count>=5 then raise exception 'ROOM_FULL'; end if;
      if exists(select 1 from public.jvf_members where room_id=p_room and lower(name)=lower(btrim(p_name))) then raise exception 'NAME_TAKEN'; end if;
      insert into public.jvf_members(id,room_id,name,token_hash) values(p_member,p_room,btrim(p_name),p_token_hash);
    end if;
  else
    if not exists(select 1 from public.jvf_rooms where id=p_room) then raise exception 'ROOM_NOT_FOUND'; end if;
    if not exists(select 1 from public.jvf_members where id=p_member and room_id=p_room and token_hash=p_token_hash) then raise exception 'ACCESS_DENIED'; end if;
    if p_action='vote' then
      if p_game is null or char_length(p_game) not between 1 and 40 or p_vote is null or p_vote not in ('yes','super','no','clear') then raise exception 'INVALID_INPUT'; end if;
      select vote into v_previous_vote from public.jvf_votes where room_id=p_room and member_id=p_member and game_id=p_game;
      if p_vote='clear' then
        delete from public.jvf_votes where room_id=p_room and member_id=p_member and game_id=p_game;
      else
        insert into public.jvf_votes(room_id,member_id,game_id,vote) values(p_room,p_member,p_game,p_vote)
        on conflict(room_id,member_id,game_id) do update set vote=excluded.vote,updated_at=now();
      end if;
    end if;
  end if;
  if p_action<>'state' then
    insert into public.jvf_events(room_id,member_id,action,game_id,previous_vote,new_vote)
    values(p_room,p_member,p_action,p_game,v_previous_vote,case when p_vote='clear' then null else p_vote end);
  end if;
  return pg_catalog.jsonb_build_object(
    'room',p_room,'capacity',5,'me',p_member,
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'votes',(select count(*) from public.jvf_votes v where v.member_id=m.id and v.room_id=p_room)) order by m.created_at,m.id) from public.jvf_members m where m.room_id=p_room),'[]'::jsonb),
    'votes',coalesce((select jsonb_object_agg(game_id,vote) from public.jvf_votes where room_id=p_room and member_id=p_member),'{}'::jsonb),
    'matches',coalesce((select jsonb_agg(game_id order by game_id) from (select game_id from public.jvf_votes where room_id=p_room and vote in ('yes','super') group by game_id having count(distinct member_id)=5) agreed),'[]'::jsonb)
  );
end;
$$;
commit;
