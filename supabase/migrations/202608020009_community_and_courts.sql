-- 커뮤니티(회원 목록·공지·매칭 게시판), 프로필 사진, 고정 코트 규칙,
-- 권고 순환, 게임 취소 기능을 추가한다.

-- 1. 프로필 사진 -------------------------------------------------------------

alter table public.members
  add column if not exists avatar_url text
  check (avatar_url is null or char_length(avatar_url) <= 500);

create or replace function public.update_my_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if p_avatar_url is not null then
    if char_length(p_avatar_url) > 500
      or p_avatar_url !~ '^https?://' then
      raise exception '올바르지 않은 사진 주소입니다.';
    end if;
  end if;

  update public.members
  set avatar_url = p_avatar_url
  where id = actor_id
    and is_active;

  if not found then
    raise exception '활성 회원 정보를 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.update_my_avatar(text) from public;
grant execute on function public.update_my_avatar(text) to authenticated;

-- 아바타 저장용 공개 버킷과 본인 폴더 쓰기 정책
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_public_read'
  ) then
    create policy avatars_public_read
    on storage.objects for select
    using (bucket_id = 'avatars');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_owner_insert'
  ) then
    create policy avatars_owner_insert
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'avatars'
      and split_part(name, '/', 1) = auth.uid()::text
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_owner_update'
  ) then
    create policy avatars_owner_update
    on storage.objects for update to authenticated
    using (
      bucket_id = 'avatars'
      and split_part(name, '/', 1) = auth.uid()::text
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_owner_delete'
  ) then
    create policy avatars_owner_delete
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'avatars'
      and split_part(name, '/', 1) = auth.uid()::text
    );
  end if;
end;
$$;

-- 2. 게시판 (공지·외부게임 매칭) ---------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'post_category') then
    create type public.post_category as enum ('notice', 'matching');
  end if;
end;
$$;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  author_id uuid not null references public.members(id) on delete cascade,
  category public.post_category not null,
  title text not null check (char_length(title) between 1 and 80),
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_club_category_idx
  on public.posts (club_id, category, created_at desc);

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

drop policy if exists posts_read_same_club on public.posts;
create policy posts_read_same_club
on public.posts
for select
to authenticated
using (public.is_active_member_of(club_id));

grant select on public.posts to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posts'
  ) then
    execute 'alter publication supabase_realtime add table public.posts';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'members'
  ) then
    execute 'alter publication supabase_realtime add table public.members';
  end if;
end;
$$;

create or replace function public.create_post(
  p_category public.post_category,
  p_title text,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor public.members%rowtype;
  new_post_id uuid;
begin
  select * into actor
  from public.members
  where id = actor_id and is_active;

  if actor.id is null then
    raise exception '활성 회원만 글을 쓸 수 있습니다.';
  end if;

  if p_category = 'notice' and actor.role <> 'owner' then
    raise exception '공지사항은 관리자만 작성할 수 있습니다.';
  end if;

  if char_length(trim(p_title)) not between 1 and 80 then
    raise exception '제목은 1자 이상 80자 이하로 입력해 주세요.';
  end if;

  if char_length(trim(p_content)) not between 1 and 2000 then
    raise exception '내용은 1자 이상 2000자 이하로 입력해 주세요.';
  end if;

  insert into public.posts (club_id, author_id, category, title, content)
  values (actor.club_id, actor.id, p_category, trim(p_title), trim(p_content))
  returning id into new_post_id;

  return new_post_id;
end;
$$;

create or replace function public.delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor public.members%rowtype;
  target public.posts%rowtype;
begin
  select * into actor
  from public.members
  where id = actor_id and is_active;

  if actor.id is null then
    raise exception '활성 회원만 글을 삭제할 수 있습니다.';
  end if;

  select * into target
  from public.posts
  where id = p_post_id and club_id = actor.club_id;

  if target.id is null then
    raise exception '삭제할 글을 찾을 수 없습니다.';
  end if;

  if target.author_id <> actor.id and actor.role <> 'owner' then
    raise exception '본인 글 또는 관리자만 삭제할 수 있습니다.';
  end if;

  delete from public.posts where id = p_post_id;
end;
$$;

revoke all on function public.create_post(public.post_category, text, text)
from public;
revoke all on function public.delete_post(uuid) from public;
grant execute on function public.create_post(public.post_category, text, text)
to authenticated;
grant execute on function public.delete_post(uuid) to authenticated;

-- 3. 고정 코트 규칙 ----------------------------------------------------------
-- 코트는 A·B·C 세 면으로 고정하며, 같은 코트에 열린/진행 중 게임이 있으면
-- 새 게임을 만들 수 없다. 코트 A(레슨 코트) 안내는 화면에서 처리한다.

create or replace function public.assert_court_available(
  p_game_day_id uuid,
  p_court_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if trim(p_court_name) not in ('코트 A', '코트 B', '코트 C') then
    raise exception '코트 A, 코트 B, 코트 C 중에서 선택해 주세요.';
  end if;

  if exists (
    select 1
    from public.game_slots
    where game_day_id = p_game_day_id
      and court_name = trim(p_court_name)
      and status in ('open', 'playing')
  ) then
    raise exception '해당 코트에 이미 진행 중이거나 모집 중인 게임이 있습니다.';
  end if;
end;
$$;

revoke all on function public.assert_court_available(uuid, text)
from public, anon, authenticated;

create or replace function public.create_game_slot(p_court_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  new_slot_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 게임 슬롯을 만들 수 있습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  insert into public.game_days (club_id, game_date)
  values (actor_club_id, public.seoul_today())
  on conflict (club_id, game_date) do nothing;

  select id
  into target_day_id
  from public.game_days
  where club_id = actor_club_id
    and game_date = public.seoul_today()
  for update;

  perform public.assert_court_available(target_day_id, p_court_name);

  insert into public.game_slots (
    club_id,
    game_day_id,
    court_name,
    source,
    created_by
  )
  values (
    actor_club_id,
    target_day_id,
    trim(p_court_name),
    'manual',
    actor_id
  )
  returning id into new_slot_id;

  return new_slot_id;
end;
$$;

-- 4. 권고 순환 ---------------------------------------------------------------
-- 순환은 권고 사항이다. 자기 차례가 아니어도 참여할 수 있으며,
-- 차례 여부 안내와 재확인은 화면에서 처리한다.

create or replace function public.join_game_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  slot_status public.game_slot_status;
  cycle_number integer;
  attendance_record public.game_attendances%rowtype;
  player_count integer;
  selected_team public.team_type;
  new_player_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 게임에 참여할 수 있습니다.';
  end if;

  select game_day_id, status
  into target_day_id, slot_status
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id;

  if target_day_id is null or slot_status <> 'open' then
    raise exception '현재 참여할 수 없는 슬롯입니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  select status
  into slot_status
  from public.game_slots
  where id = p_slot_id
    and game_day_id = target_day_id
  for update;

  if slot_status <> 'open' then
    raise exception '현재 참여할 수 없는 슬롯입니다.';
  end if;

  select current_cycle
  into cycle_number
  from public.game_days
  where id = target_day_id
    and game_date = public.seoul_today()
  for update;

  if cycle_number is null then
    raise exception '오늘 생성된 슬롯이 아닙니다.';
  end if;

  select *
  into attendance_record
  from public.game_attendances
  where game_day_id = target_day_id
    and member_id = actor_id
  for update;

  if attendance_record.id is null or not attendance_record.active then
    raise exception '먼저 오늘 게임 참석을 눌러 주세요.';
  end if;

  if exists (
    select 1
    from public.game_slot_players player
    join public.game_slots slot on slot.id = player.slot_id
    where slot.game_day_id = target_day_id
      and slot.status in ('open', 'playing')
      and player.member_id = actor_id
  ) then
    raise exception '이미 다른 열린 게임에 참여 중입니다.';
  end if;

  select count(*)::integer
  into player_count
  from public.game_slot_players
  where slot_id = p_slot_id;

  if player_count >= 4 then
    raise exception '게임 슬롯이 이미 가득 찼습니다.';
  end if;

  selected_team := case
    when (
      select count(*)
      from public.game_slot_players
      where slot_id = p_slot_id
        and team = 'A'
    ) < 2 then 'A'::public.team_type
    else 'B'::public.team_type
  end;

  insert into public.game_slot_players (
    club_id,
    slot_id,
    member_id,
    team,
    joined_cycle,
    skill_score
  )
  values (
    actor_club_id,
    p_slot_id,
    actor_id,
    selected_team,
    cycle_number,
    coalesce(public.member_skill_score(actor_id), 0)
  )
  returning id into new_player_id;

  update public.game_attendances
  set last_joined_cycle = greatest(last_joined_cycle, cycle_number)
  where id = attendance_record.id;

  perform public.advance_game_cycle_if_complete(target_day_id);
  return new_player_id;
end;
$$;

-- 5. 게임 취소 ---------------------------------------------------------------

create or replace function public.cancel_game_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  slot_status public.game_slot_status;
begin
  if actor_club_id is null then
    raise exception '활성 회원만 게임을 취소할 수 있습니다.';
  end if;

  select game_day_id, status
  into target_day_id, slot_status
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id;

  if target_day_id is null then
    raise exception '취소할 게임을 찾을 수 없습니다.';
  end if;

  if slot_status not in ('open', 'playing') then
    raise exception '이미 종료되었거나 취소된 게임입니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  perform 1
  from public.game_slots
  where id = p_slot_id
    and status in ('open', 'playing')
  for update;

  if not found then
    raise exception '이미 종료되었거나 취소된 게임입니다.';
  end if;

  -- 참여자들의 순환 상태를 되돌려 다른 게임에 다시 참여할 수 있게 한다.
  update public.game_attendances attendance
  set last_joined_cycle = least(
    attendance.last_joined_cycle,
    greatest(player.joined_cycle - 1, 0)
  )
  from public.game_slot_players player
  where player.slot_id = p_slot_id
    and attendance.game_day_id = target_day_id
    and attendance.member_id = player.member_id;

  update public.game_slots
  set status = 'cancelled'
  where id = p_slot_id;
end;
$$;

revoke all on function public.cancel_game_slot(uuid) from public;
grant execute on function public.cancel_game_slot(uuid) to authenticated;

-- 6. 자동 배치도 고정 코트 규칙을 따르도록 갱신 -------------------------------

create or replace function public.confirm_auto_arrangement(
  p_court_name text,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  cycle_number integer;
  new_slot_id uuid;
begin
  if actor_club_id is null then
    raise exception '활성 회원만 자동 배치를 확정할 수 있습니다.';
  end if;

  if jsonb_typeof(p_players) <> 'array'
    or jsonb_array_length(p_players) <> 4 then
    raise exception '자동 배치에는 서로 다른 4명이 필요합니다.';
  end if;

  if (
    select count(distinct value ->> 'memberId')
    from jsonb_array_elements(p_players)
  ) <> 4 then
    raise exception '중복된 회원이 포함되어 있습니다.';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_players)
    where value ->> 'team' = 'A'
  ) <> 2 or (
    select count(*)
    from jsonb_array_elements(p_players)
    where value ->> 'team' = 'B'
  ) <> 2 then
    raise exception 'A팀과 B팀에 각각 2명을 배치해 주세요.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  insert into public.game_days (club_id, game_date)
  values (actor_club_id, public.seoul_today())
  on conflict (club_id, game_date) do nothing;

  select id, current_cycle
  into target_day_id, cycle_number
  from public.game_days
  where club_id = actor_club_id
    and game_date = public.seoul_today()
  for update;

  perform public.assert_court_available(target_day_id, p_court_name);

  if exists (
    with candidates as (
      select (value ->> 'memberId')::uuid as member_id
      from jsonb_array_elements(p_players)
    )
    select 1
    from candidates candidate
    left join public.game_attendances attendance
      on attendance.game_day_id = target_day_id
      and attendance.member_id = candidate.member_id
    left join public.members member
      on member.id = candidate.member_id
      and member.club_id = actor_club_id
      and member.is_active
    where member.id is null
      or attendance.id is null
      or not attendance.active
      or attendance.last_joined_cycle >= cycle_number
      or exists (
        select 1
        from public.game_slot_players player
        join public.game_slots slot on slot.id = player.slot_id
        where player.member_id = candidate.member_id
          and slot.game_day_id = target_day_id
          and slot.status in ('open', 'playing')
      )
  ) then
    raise exception '참여 상태가 변경되었습니다. 자동 배치를 다시 실행해 주세요.';
  end if;

  insert into public.game_slots (
    club_id,
    game_day_id,
    court_name,
    source,
    created_by
  )
  values (
    actor_club_id,
    target_day_id,
    trim(p_court_name),
    'auto',
    actor_id
  )
  returning id into new_slot_id;

  insert into public.game_slot_players (
    club_id,
    slot_id,
    member_id,
    team,
    joined_cycle,
    skill_score
  )
  select
    actor_club_id,
    new_slot_id,
    (value ->> 'memberId')::uuid,
    (value ->> 'team')::public.team_type,
    cycle_number,
    coalesce(
      public.member_skill_score((value ->> 'memberId')::uuid),
      0
    )
  from jsonb_array_elements(p_players);

  update public.game_attendances
  set last_joined_cycle = cycle_number
  where game_day_id = target_day_id
    and member_id in (
      select (value ->> 'memberId')::uuid
      from jsonb_array_elements(p_players)
    );

  perform public.advance_game_cycle_if_complete(target_day_id);
  return new_slot_id;
end;
$$;
