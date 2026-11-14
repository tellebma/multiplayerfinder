-- Prénom + accès personnel secret, sans compte. Invitation = UUID de salon.
-- Toutes les requêtes passent par le serveur Vercel ; aucun accès SQL public.
begin;
create table if not exists public.jvf_rooms (
  id uuid primary key,
  created_at timestamptz not null default now(),
  capacity integer not null default 5 check (capacity=5)
);
create table if not exists public.jvf_members (
  id uuid primary key,
  room_id uuid not null references public.jvf_rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(room_id,id)
);
create unique index if not exists jvf_member_names on public.jvf_members(room_id,lower(name));
create table if not exists public.jvf_votes (
  room_id uuid not null references public.jvf_rooms(id) on delete cascade,
  member_id uuid not null,
  game_id text not null check (char_length(game_id) between 1 and 40),
  vote text not null check (vote in ('yes','no')),
  updated_at timestamptz not null default now(),
  primary key(room_id,member_id,game_id),
  foreign key(room_id,member_id) references public.jvf_members(room_id,id) on delete cascade
);
alter table public.jvf_rooms enable row level security;
alter table public.jvf_members enable row level security;
alter table public.jvf_votes enable row level security;
revoke all on table public.jvf_rooms,public.jvf_members,public.jvf_votes from anon,authenticated;

create or replace function public.jvf_command(
  p_action text,p_room uuid,p_member uuid,p_token_hash text,
  p_name text default '',p_game text default null,p_vote text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.jvf_rooms%rowtype;
  v_member public.jvf_members%rowtype;
  v_count integer;
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
      if p_game is null or char_length(p_game) not between 1 and 40 or p_vote is null or p_vote not in ('yes','no','clear') then raise exception 'INVALID_INPUT'; end if;
      if p_vote='clear' then
        delete from public.jvf_votes where room_id=p_room and member_id=p_member and game_id=p_game;
      else
        insert into public.jvf_votes(room_id,member_id,game_id,vote) values(p_room,p_member,p_game,p_vote)
        on conflict(room_id,member_id,game_id) do update set vote=excluded.vote,updated_at=now();
      end if;
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'room',p_room,'capacity',5,'me',p_member,
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'votes',(select count(*) from public.jvf_votes v where v.member_id=m.id and v.room_id=p_room)) order by m.created_at,m.id) from public.jvf_members m where m.room_id=p_room),'[]'::jsonb),
    'votes',coalesce((select jsonb_object_agg(game_id,vote) from public.jvf_votes where room_id=p_room and member_id=p_member),'{}'::jsonb),
    'matches',coalesce((select jsonb_agg(game_id order by game_id) from (select game_id from public.jvf_votes where room_id=p_room and vote='yes' group by game_id having count(distinct member_id)=5) agreed),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.jvf_command(text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.jvf_command(text,uuid,uuid,text,text,text,text) to service_role;
commit;
