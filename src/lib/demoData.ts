import type {
  AppSnapshot,
  GameAttendance,
  GamePlayer,
  GameSlot,
  LessonBooking,
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
  void calculateSkillScore(experienceMonths, lessonCount)

  return {
    id: `attendance-${memberId}`,
    memberId,
    nickname,
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
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-25),
    }),
    attendance('member-5', '서진', {
      gender: 'unspecified',
      experienceMonths: 20,
      lessonCount: 31,
      gamesPlayed: 2,
      lastJoinedCycle: 1,
      lastGameAt: isoFromNow(-20),
    }),
  ]

  const completedSlot: GameSlot = {
    id: 'slot-completed',
    courtName: '1번 코트',
    status: 'completed',
    source: 'manual',
    createdAt: isoFromNow(-65),
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

  return {
    member: {
      id: 'demo-me',
      clubId: 'demo-club',
      clubName: '콕콕 배드민턴',
      nickname,
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
      slots: [
        {
          id: 'slot-open',
          courtName: '2번 코트',
          status: 'open',
          source: 'manual',
          createdAt: isoFromNow(-4),
          players: [],
          result: null,
        },
        completedSlot,
      ],
    },
    records: {
      wins: 3,
      losses: 2,
      games: 5,
      lessonsThisMonth: 4,
    },
  }
}
