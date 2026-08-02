import type {
  AppSnapshot,
  CommunityMember,
  GameAttendance,
  GamePlayer,
  GameSlot,
  LessonBooking,
  Post,
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
    estimatedStartAt: isoFromNow(7 + (position - 1) * 15),
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
      lastJoinedCycle: 2,
      lastGameAt: isoFromNow(-25),
      canJoin: false,
    }),
    attendance('member-5', '서진', {
      gender: 'unspecified',
      experienceMonths: 20,
      lessonCount: 31,
      gamesPlayed: 2,
      lastJoinedCycle: 2,
      lastGameAt: isoFromNow(-20),
      canJoin: false,
    }),
    attendance('member-6', '하늘', {
      gender: 'female',
      experienceMonths: 40,
      lessonCount: 52,
      gamesPlayed: 1,
      lastJoinedCycle: 2,
      lastGameAt: isoFromNow(-18),
      canJoin: false,
    }),
    attendance('member-7', '준서', {
      gender: 'male',
      experienceMonths: 6,
      lessonCount: 8,
      gamesPlayed: 1,
      lastJoinedCycle: 2,
      lastGameAt: isoFromNow(-18),
      canJoin: false,
    }),
  ]

  const completedSlot: GameSlot = {
    id: 'slot-completed',
    courtName: '코트 B',
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
    status: 'open',
    source: 'manual',
    createdAt: isoFromNow(-4),
    startedAt: null,
    players: [],
    result: null,
  }

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
    },
  ]

  const matching: Post[] = [
    {
      id: 'matching-1',
      category: 'matching',
      title: '일요일 유성구 클럽과 교류전',
      content: '복식 2팀 모집합니다. 참여 원하시는 분 댓글 대신 연락 주세요.',
      authorId: 'member-5',
      authorNickname: '서진',
      authorAvatarUrl: null,
      createdAt: isoFromNow(-60 * 8),
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
      monthlyCount: 4,
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
    },
    records: {
      wins: 3,
      losses: 2,
      games: 5,
      lessonsThisMonth: 4,
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
