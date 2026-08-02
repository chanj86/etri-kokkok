import type {
  AppSnapshot,
  CommunityMember,
  GameAttendance,
  GamePlayer,
  GameSlot,
  LessonBooking,
  Post,
  TeamRanking,
} from '../types'
import { calculateSkillScore } from './gameMatching'
import { toSeoulDateKey } from './format'

const MINUTE = 60_000

function isoFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * MINUTE).toISOString()
}

function lessonBooking(
  id: string,
  memberId: string,
  nickname: string,
  position: number,
  isMine = false,
): LessonBooking {
  return {
    id,
    memberId,
    nickname,
    position,
    joinedAt: isoFromNow(-45 + position),
    // 1번은 8분 전에 레슨을 시작한 상태(7분 남음)로 둔다.
    estimatedStartAt: isoFromNow(-8 + (position - 1) * 15),
    status: 'waiting',
    isMine,
  }
}

function attendance(
  memberId: string,
  nickname: string,
  options: Partial<GameAttendance> = {},
): GameAttendance {
  const experienceMonths = options.experienceMonths ?? 18
  const lessonCount = options.lessonCount ?? 20

  return {
    id: `attendance-${memberId}`,
    memberId,
    nickname,
    avatarUrl: null,
    gender: options.gender ?? 'unspecified',
    experienceMonths,
    lessonCount,
    gamesPlayed: options.gamesPlayed ?? 1,
    lastJoinedCycle: options.lastJoinedCycle ?? 1,
    lastGameAt: options.lastGameAt ?? isoFromNow(-40),
    active: options.active ?? true,
    canJoin: options.canJoin ?? true,
  }
}

function player(
  memberId: string,
  nickname: string,
  team: 'A' | 'B',
  joinedCycle: number,
  experienceMonths: number,
  lessonCount: number,
): GamePlayer {
  return {
    id: `player-${memberId}-${joinedCycle}`,
    memberId,
    nickname,
    isGuest: false,
    team,
    joinedCycle,
    skillScore: calculateSkillScore(experienceMonths, lessonCount),
  }
}

function communityMember(
  memberId: string,
  nickname: string,
  options: Partial<CommunityMember> = {},
): CommunityMember {
  const games = options.games ?? 0
  const wins = options.wins ?? 0
  return {
    memberId,
    nickname,
    avatarUrl: options.avatarUrl ?? null,
    role: options.role ?? 'member',
    gender: options.gender ?? 'unspecified',
    experienceMonths: options.experienceMonths ?? 12,
    lessonCount: options.lessonCount ?? 10,
    joinedAt: options.joinedAt ?? isoFromNow(-60 * 24 * 90),
    games,
    wins,
    losses: games - wins,
  }
}

export function createDemoSnapshot(nickname = '민준'): AppSnapshot {
  const today = toSeoulDateKey()

  // 이번 달 안에서 오늘 포함 최대 4일의 참석 이력을 만든다.
  const monthlyDates = [0, 2, 4, 6]
    .map((offset) => {
      const date = new Date()
      date.setDate(date.getDate() - offset)
      return toSeoulDateKey(date)
    })
    .filter((dateKey) => dateKey.slice(0, 7) === today.slice(0, 7))
    .sort()
  const lessonQueue = [
    lessonBooking('lesson-1', 'member-1', '소연', 1),
    lessonBooking('lesson-2', 'member-2', '현우', 2),
    lessonBooking('lesson-me', 'demo-me', nickname, 3, true),
    lessonBooking('lesson-4', 'member-4', '지수', 4),
  ]

  const attendees: GameAttendance[] = [
    attendance('demo-me', nickname, {
      gender: 'male',
      experienceMonths: 24,
      lessonCount: 28,
      gamesPlayed: 1,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-55),
    }),
    attendance('member-1', '소연', {
      gender: 'female',
      experienceMonths: 30,
      lessonCount: 45,
      gamesPlayed: 1,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-50),
    }),
    attendance('member-2', '현우', {
      gender: 'male',
      experienceMonths: 12,
      lessonCount: 18,
      gamesPlayed: 1,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-45),
    }),
    attendance('member-3', '윤아', {
      gender: 'female',
      experienceMonths: 16,
      lessonCount: 24,
      gamesPlayed: 1,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-42),
    }),
    attendance('member-4', '도윤', {
      gender: 'male',
      experienceMonths: 8,
      lessonCount: 12,
      gamesPlayed: 2,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-25),
      canJoin: false,
    }),
    attendance('member-5', '서진', {
      gender: 'unspecified',
      experienceMonths: 20,
      lessonCount: 31,
      gamesPlayed: 2,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-20),
      canJoin: false,
    }),
    attendance('member-6', '하늘', {
      gender: 'female',
      experienceMonths: 40,
      lessonCount: 52,
      gamesPlayed: 1,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-18),
      canJoin: false,
    }),
    attendance('member-7', '준서', {
      gender: 'male',
      experienceMonths: 6,
      lessonCount: 8,
      gamesPlayed: 1,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-18),
      canJoin: false,
    }),
  ]

  const completedSlot: GameSlot = {
    id: 'slot-completed',
    courtName: '코트 B',
    gameType: 'doubles',
    status: 'completed',
    source: 'manual',
    createdAt: isoFromNow(-65),
    startedAt: isoFromNow(-60),
    players: [
      player('demo-me', nickname, 'A', 1, 24, 28),
      player('member-1', '소연', 'A', 1, 30, 45),
      player('member-2', '현우', 'B', 1, 12, 18),
      player('member-3', '윤아', 'B', 1, 16, 24),
    ],
    result: {
      teamAScore: 21,
      teamBScore: 17,
      winnerTeam: 'A',
    },
  }

  const playingSlot: GameSlot = {
    id: 'slot-playing',
    courtName: '코트 C',
    gameType: 'doubles',
    status: 'playing',
    source: 'manual',
    createdAt: isoFromNow(-25),
    startedAt: isoFromNow(-17),
    players: [
      player('member-4', '도윤', 'A', 2, 8, 12),
      player('member-5', '서진', 'A', 2, 20, 31),
      player('member-6', '하늘', 'B', 2, 40, 52),
      player('member-7', '준서', 'B', 2, 6, 8),
    ],
    result: null,
  }

  const openSlot: GameSlot = {
    id: 'slot-open',
    courtName: '코트 B',
    gameType: 'doubles',
    status: 'open',
    source: 'manual',
    createdAt: isoFromNow(-4),
    startedAt: null,
    players: [],
    result: null,
  }

  const emptyEventFields = {
    eventDate: null,
    eventTime: null,
    location: null,
    capacity: null,
    participants: [],
    myJoined: false,
  }

  const matchingDate = new Date(Date.now() + 5 * 24 * 60 * MINUTE)
    .toISOString()
    .slice(0, 10)

  const notices: Post[] = [
    {
      id: 'notice-1',
      category: 'notice',
      title: '8월 정기 모임 안내',
      content:
        '이번 주 토요일 오후 5시부터 정기 모임을 진행합니다. 셔틀콕은 동호회에서 준비합니다.',
      authorId: 'member-1',
      authorNickname: '소연',
      authorAvatarUrl: null,
      createdAt: isoFromNow(-60 * 5),
      ...emptyEventFields,
    },
    {
      id: 'notice-2',
      category: 'notice',
      title: '코트 A 레슨 시간 변경',
      content: '이번 달부터 레슨 시작 시간이 17시로 고정됩니다.',
      authorId: 'member-1',
      authorNickname: '소연',
      authorAvatarUrl: null,
      createdAt: isoFromNow(-60 * 24 * 2),
      ...emptyEventFields,
    },
  ]

  const matching: Post[] = [
    {
      id: 'matching-1',
      category: 'matching',
      title: '일요일 유성구 클럽과 교류전',
      content: '복식 2팀 모집합니다. 셔틀콕과 간식은 준비되어 있어요.',
      authorId: 'member-5',
      authorNickname: '서진',
      authorAvatarUrl: null,
      createdAt: isoFromNow(-60 * 8),
      eventDate: matchingDate,
      eventTime: '10:00',
      location: '유성구민체육관',
      capacity: 4,
      participants: [
        { memberId: 'member-5', nickname: '서진', avatarUrl: null },
        { memberId: 'member-1', nickname: '소연', avatarUrl: null },
        { memberId: 'member-6', nickname: '하늘', avatarUrl: null },
      ],
      myJoined: false,
    },
    {
      id: 'matching-2',
      category: 'matching',
      title: '수요일 저녁 게스트 1명',
      content: '중급 이상이면 좋아요. 라켓만 들고 오세요.',
      authorId: 'member-2',
      authorNickname: '현우',
      authorAvatarUrl: null,
      createdAt: isoFromNow(-60 * 26),
      eventDate: matchingDate,
      eventTime: '19:30',
      location: '반석체육관',
      capacity: 1,
      participants: [
        { memberId: 'member-3', nickname: '윤아', avatarUrl: null },
      ],
      myJoined: false,
    },
  ]

  const members: CommunityMember[] = [
    communityMember('demo-me', nickname, {
      role: 'owner',
      gender: 'male',
      experienceMonths: 24,
      lessonCount: 28,
      games: 5,
      wins: 3,
    }),
    communityMember('member-1', '소연', {
      gender: 'female',
      experienceMonths: 30,
      lessonCount: 45,
      games: 8,
      wins: 6,
    }),
    communityMember('member-2', '현우', {
      gender: 'male',
      experienceMonths: 12,
      lessonCount: 18,
      games: 4,
      wins: 1,
    }),
    communityMember('member-3', '윤아', {
      gender: 'female',
      experienceMonths: 16,
      lessonCount: 24,
      games: 6,
      wins: 3,
    }),
    communityMember('member-4', '도윤', {
      gender: 'male',
      experienceMonths: 8,
      lessonCount: 12,
      games: 3,
      wins: 1,
    }),
    communityMember('member-5', '서진', {
      experienceMonths: 20,
      lessonCount: 31,
      games: 7,
      wins: 4,
    }),
    communityMember('member-6', '하늘', {
      gender: 'female',
      experienceMonths: 40,
      lessonCount: 52,
      games: 12,
      wins: 9,
    }),
    communityMember('member-7', '준서', {
      gender: 'male',
      experienceMonths: 6,
      lessonCount: 8,
      games: 2,
      wins: 0,
    }),
  ]

  const teamRankings: TeamRanking[] = [
    {
      memberAId: 'member-6',
      memberANickname: '하늘',
      memberAAvatarUrl: null,
      memberBId: 'member-1',
      memberBNickname: '소연',
      memberBAvatarUrl: null,
      games: 6,
      wins: 5,
      losses: 1,
    },
    {
      memberAId: 'demo-me',
      memberANickname: nickname,
      memberAAvatarUrl: null,
      memberBId: 'member-1',
      memberBNickname: '소연',
      memberBAvatarUrl: null,
      games: 3,
      wins: 2,
      losses: 1,
    },
    {
      memberAId: 'member-5',
      memberANickname: '서진',
      memberAAvatarUrl: null,
      memberBId: 'member-3',
      memberBNickname: '윤아',
      memberBAvatarUrl: null,
      games: 4,
      wins: 2,
      losses: 2,
    },
    {
      memberAId: 'member-4',
      memberANickname: '도윤',
      memberAAvatarUrl: null,
      memberBId: 'member-7',
      memberBNickname: '준서',
      memberBAvatarUrl: null,
      games: 3,
      wins: 1,
      losses: 2,
    },
  ]

  return {
    member: {
      id: 'demo-me',
      clubId: 'demo-club',
      clubName: 'ETRI 콕콕',
      nickname,
      avatarUrl: null,
      role: 'owner',
      gender: 'male',
      experienceMonths: 24,
      priorLessonCount: 12,
      joinedAt: isoFromNow(-60 * 24 * 120),
    },
    lesson: {
      sessionId: 'demo-lesson-session',
      sessionDate: today,
      canJoin: true,
      queue: lessonQueue,
      myBooking: lessonQueue[2],
      monthlyCount: monthlyDates.length,
      monthlyDates,
    },
    game: {
      dayId: 'demo-game-day',
      dayDate: today,
      currentCycle: 2,
      myAttendanceActive: true,
      myCanJoin: true,
      attendees,
      slots: [openSlot, playingSlot, completedSlot],
    },
    community: {
      members,
      notices,
      matching,
      teamRankings,
    },
    records: {
      wins: 3,
      losses: 2,
      games: 5,
      lessonsThisMonth: monthlyDates.length,
      partnerStats: [
        {
          memberId: 'member-1',
          nickname: '소연',
          games: 3,
          wins: 2,
          losses: 1,
          winRate: 67,
          lastPlayedAt: completedSlot.createdAt,
        },
        {
          memberId: 'member-3',
          nickname: '윤아',
          games: 1,
          wins: 1,
          losses: 0,
          winRate: 100,
          lastPlayedAt: isoFromNow(-60 * 24 * 4),
        },
        {
          memberId: 'member-2',
          nickname: '현우',
          games: 1,
          wins: 0,
          losses: 1,
          winRate: 0,
          lastPlayedAt: isoFromNow(-60 * 24 * 8),
        },
      ],
    },
  }
}
