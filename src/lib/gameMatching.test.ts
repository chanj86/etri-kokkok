import { describe, expect, it } from 'vitest'
import type { GameAttendance } from '../types'
import {
  buildAutoArrangement,
  calculateSkillScore,
} from './gameMatching'

function attendee(
  memberId: string,
  options: Partial<GameAttendance> = {},
): GameAttendance {
  return {
    id: `attendance-${memberId}`,
    memberId,
    nickname: memberId,
    gender: 'unspecified',
    experienceMonths: 12,
    lessonCount: 10,
    gamesPlayed: 0,
    lastJoinedCycle: 1,
    lastGameAt: null,
    active: true,
    canJoin: true,
    ...options,
  }
}

describe('게임 자동 배치', () => {
  it('게임 수가 적고 오래 기다린 회원을 먼저 선택한다', () => {
    const result = buildAutoArrangement(
      [
        attendee('세게임', { gamesPlayed: 3 }),
        attendee('첫번째', {
          gamesPlayed: 1,
          lastGameAt: '2026-07-31T07:00:00.000Z',
        }),
        attendee('두번째', {
          gamesPlayed: 1,
          lastGameAt: '2026-07-31T07:10:00.000Z',
        }),
        attendee('세번째', { gamesPlayed: 2 }),
        attendee('네번째', { gamesPlayed: 2 }),
      ],
      2,
      '1번 코트',
      'fixed-token',
    )

    expect(result?.candidates.map((candidate) => candidate.memberId)).toEqual([
      '첫번째',
      '두번째',
      '네번째',
      '세번째',
    ])
    expect(result?.candidates).toHaveLength(4)
  })

  it('가능한 팀 조합 중 전력 합 차이가 가장 작은 조합을 선택한다', () => {
    const result = buildAutoArrangement(
      [
        attendee('강1', {
          gender: 'male',
          experienceMonths: 64,
          lessonCount: 64,
        }),
        attendee('강2', {
          gender: 'female',
          experienceMonths: 49,
          lessonCount: 49,
        }),
        attendee('약1', {
          gender: 'male',
          experienceMonths: 9,
          lessonCount: 9,
        }),
        attendee('약2', {
          gender: 'female',
          experienceMonths: 4,
          lessonCount: 4,
        }),
      ],
      2,
      '2번 코트',
      'fixed-token',
    )

    const teamA = result!.candidates
      .filter((candidate) => candidate.team === 'A')
      .reduce((sum, candidate) => sum + candidate.skillScore, 0)
    const teamB = result!.candidates
      .filter((candidate) => candidate.team === 'B')
      .reduce((sum, candidate) => sum + candidate.skillScore, 0)

    expect(result?.candidates.filter((item) => item.team === 'A')).toHaveLength(2)
    expect(result?.candidates.filter((item) => item.team === 'B')).toHaveLength(2)
    expect(Math.abs(teamA - teamB)).toBeLessThan(
      calculateSkillScore(64, 64),
    )
  })

  it('현재 순환에 참여할 수 없는 회원은 후보에서 제외한다', () => {
    const result = buildAutoArrangement(
      [
        attendee('잠김', {
          lastJoinedCycle: 2,
          canJoin: false,
        }),
        attendee('A'),
        attendee('B'),
        attendee('C'),
        attendee('D'),
      ],
      2,
      '1번 코트',
      'fixed-token',
    )

    expect(result?.candidates.map((candidate) => candidate.memberId)).not.toContain(
      '잠김',
    )
  })

  it('참여 가능한 회원이 4명보다 적으면 추천하지 않는다', () => {
    const result = buildAutoArrangement(
      [attendee('A'), attendee('B'), attendee('C')],
      2,
      '1번 코트',
      'fixed-token',
    )

    expect(result).toBeNull()
  })
})
