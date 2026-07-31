import type {
  AutoArrangement,
  GameAttendance,
  Gender,
  Team,
} from '../types'
import { formatWaitTime } from './format'

export function calculateSkillScore(
  experienceMonths: number,
  lessonCount: number,
): number {
  const experienceScore = Math.sqrt(Math.max(0, experienceMonths)) * 8
  const lessonScore = Math.sqrt(Math.max(0, lessonCount)) * 5
  return Math.round((experienceScore + lessonScore) * 10) / 10
}

function compareCandidates(a: GameAttendance, b: GameAttendance): number {
  if (a.gamesPlayed !== b.gamesPlayed) {
    return a.gamesPlayed - b.gamesPlayed
  }

  if (a.lastGameAt === null && b.lastGameAt !== null) return -1
  if (a.lastGameAt !== null && b.lastGameAt === null) return 1

  const aTime = a.lastGameAt ? new Date(a.lastGameAt).getTime() : 0
  const bTime = b.lastGameAt ? new Date(b.lastGameAt).getTime() : 0
  if (aTime !== bTime) return aTime - bTime

  return a.nickname.localeCompare(b.nickname, 'ko')
}

function mixedTeamPenalty(genders: Gender[]): number {
  const known = genders.filter((gender) => gender !== 'unspecified')
  if (known.length < 2) return 0
  return new Set(known).size === 1 ? 8 : 0
}

interface TeamSplit {
  a: number[]
  b: number[]
}

const teamSplits: TeamSplit[] = [
  { a: [0, 1], b: [2, 3] },
  { a: [0, 2], b: [1, 3] },
  { a: [0, 3], b: [1, 2] },
]

export function buildAutoArrangement(
  attendees: GameAttendance[],
  currentCycle: number,
  courtName: string,
  token: string = crypto.randomUUID(),
): AutoArrangement | null {
  const selected = attendees
    .filter(
      (attendee) =>
        attendee.active &&
        attendee.canJoin &&
        attendee.lastJoinedCycle < currentCycle,
    )
    .sort(compareCandidates)
    .slice(0, 4)

  if (selected.length < 4) return null

  const scores = selected.map((attendee) =>
    calculateSkillScore(attendee.experienceMonths, attendee.lessonCount),
  )

  const bestSplit = teamSplits
    .map((split) => {
      const aScore = split.a.reduce((sum, index) => sum + scores[index], 0)
      const bScore = split.b.reduce((sum, index) => sum + scores[index], 0)
      const genderPenalty =
        mixedTeamPenalty(split.a.map((index) => selected[index].gender)) +
        mixedTeamPenalty(split.b.map((index) => selected[index].gender))

      return {
        ...split,
        aScore,
        bScore,
        cost: Math.abs(aScore - bScore) + genderPenalty,
      }
    })
    .sort((a, b) => a.cost - b.cost)[0]

  const teamByIndex = new Map<number, Team>()
  bestSplit.a.forEach((index) => teamByIndex.set(index, 'A'))
  bestSplit.b.forEach((index) => teamByIndex.set(index, 'B'))

  return {
    token,
    courtName,
    candidates: selected.map((attendee, index) => ({
      memberId: attendee.memberId,
      nickname: attendee.nickname,
      team: teamByIndex.get(index) ?? 'A',
      skillScore: scores[index],
      reason: `${attendee.gamesPlayed}게임 · ${formatWaitTime(attendee.lastGameAt)}`,
    })),
    teamAScore: Math.round(bestSplit.aScore * 10) / 10,
    teamBScore: Math.round(bestSplit.bScore * 10) / 10,
    explanation:
      '이번 순환의 참여 가능 회원 중 게임 수가 적고 오래 기다린 순서로 선택한 뒤 팀 전력 차를 최소화했습니다.',
  }
}
