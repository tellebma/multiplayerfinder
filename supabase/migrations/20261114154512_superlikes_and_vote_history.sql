-- Positive votes remain backward compatible; super-likes count as yes for matches.
-- Audit successful actions only; never record tokens, token hashes, or polling calls.
begin;
alter table public.jvf_votes drop constraint if exists jvf_votes_vote_check;
alter table public.jvf_votes add constraint jvf_votes_vote_check check(vote in ('yes','super','no'));
create table public.jvf_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.jvf_rooms(id) on delete cascade,
  member_id uuid not null,
  action text not null check(action in ('create','join','vote')),
  game_id text,
  previous_vote text,
  new_vote text,
  created_at timestamptz not null default now()
);
create index jvf_events_room_created on public.jvf_events(room_id,created_at desc);
alter table public.jvf_events enable row level security;
revoke all on public.jvf_events from public,anon,authenticated;
grant select,insert on public.jvf_events to service_role;
grant usage on sequence public.jvf_events_id_seq to service_role;
grant update on public.jvf_rooms to service_role;
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
revoke all on function public.jvf_command(text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.jvf_command(text,uuid,uuid,text,text,text,text) to service_role;
commit;
