import { describe, expect, it } from 'vitest'
import {
  calculateLessonStartTimes,
  lessonOpensAt,
  minutesUntil,
} from './lessonSchedule'

describe('레슨 시간 배정', () => {
  it('첫 도착이 17시 전이면 17시부터 15분 간격으로 배정한다', () => {
    const result = calculateLessonStartTimes('2026-07-31', [
      '2026-07-31T07:55:00.000Z',
      '2026-07-31T08:01:00.000Z',
      '2026-07-31T08:02:00.000Z',
    ])

    expect(result).toEqual([
      '2026-07-31T08:00:00.000Z',
      '2026-07-31T08:15:00.000Z',
      '2026-07-31T08:30:00.000Z',
    ])
  })

  it('첫 도착이 17시 이후면 실제 첫 도착부터 배정한다', () => {
    const result = calculateLessonStartTimes('2026-07-31', [
      '2026-07-31T08:07:00.000Z',
      '2026-07-31T08:09:00.000Z',
    ])

    expect(result).toEqual([
      '2026-07-31T08:07:00.000Z',
      '2026-07-31T08:22:00.000Z',
    ])
  })

  it('빈 대기열은 빈 시간 목록을 반환한다', () => {
    expect(calculateLessonStartTimes('2026-07-31', [])).toEqual([])
  })

  it('한국 시간 17시를 정확한 UTC 시각으로 변환한다', () => {
    expect(lessonOpensAt('2026-07-31').toISOString()).toBe(
      '2026-07-31T08:00:00.000Z',
    )
  })

  it('예상 시각까지 남은 분을 올림 계산한다', () => {
    expect(
      minutesUntil(
        '2026-07-31T08:15:30.000Z',
        new Date('2026-07-31T08:00:00.000Z'),
      ),
    ).toBe(16)
  })
})
