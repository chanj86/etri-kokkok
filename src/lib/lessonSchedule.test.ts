import { describe, expect, it } from 'vitest'
import {
  calculateLessonStartTimes,
  isLessonTime,
  lessonOpensAt,
  minutesUntil,
} from './lessonSchedule'

describe('레슨 시간 배정', () => {
  it('첫 도착이 17시 전이면 17시부터 15분 간격으로 배정한다', () => {
    const result = calculateLessonStartTimes(
      '2026-07-31',
      [
        { joinedAt: '2026-07-31T07:55:00.000Z' },
        { joinedAt: '2026-07-31T08:01:00.000Z' },
        { joinedAt: '2026-07-31T08:02:00.000Z' },
      ],
      new Date('2026-07-31T07:56:00.000Z'),
    )

    expect(result).toEqual([
      '2026-07-31T08:00:00.000Z',
      '2026-07-31T08:15:00.000Z',
      '2026-07-31T08:30:00.000Z',
    ])
  })

  it('첫 도착이 17시 이후면 실제 첫 도착부터 배정한다', () => {
    const result = calculateLessonStartTimes(
      '2026-07-31',
      [
        { joinedAt: '2026-07-31T08:07:00.000Z' },
        { joinedAt: '2026-07-31T08:09:00.000Z' },
      ],
      new Date('2026-07-31T08:07:00.000Z'),
    )

    expect(result).toEqual([
      '2026-07-31T08:07:00.000Z',
      '2026-07-31T08:22:00.000Z',
    ])
  })

  it('진행 중 레슨(10분 경과)의 남은 시간을 기준으로 뒤 순서를 잇는다', () => {
    // 예: 현재 레슨이 10분 진행돼 5분 남았고 대기자가 2명이면
    // 내 레슨은 5 + 15 + 15 = 35분 후에 시작한다.
    const now = new Date('2026-07-31T08:40:00.000Z')
    const result = calculateLessonStartTimes(
      '2026-07-31',
      [
        {
          joinedAt: '2026-07-31T08:00:00.000Z',
          estimatedStartAt: '2026-07-31T08:30:00.000Z', // 10분 경과, 진행 중
        },
        { joinedAt: '2026-07-31T08:10:00.000Z' },
        { joinedAt: '2026-07-31T08:20:00.000Z' },
        { joinedAt: '2026-07-31T08:40:00.000Z' }, // 나
      ],
      now,
    )

    expect(result).toEqual([
      '2026-07-31T08:30:00.000Z', // 진행 중 유지
      '2026-07-31T08:45:00.000Z', // 5분 후
      '2026-07-31T09:00:00.000Z',
      '2026-07-31T09:15:00.000Z', // 35분 후 = 내 차례
    ])
    expect(minutesUntil(result[3], now)).toBe(35)
  })

  it('앞사람이 빠져 시간이 당겨져도 현재 시각보다 이르게 잡지 않는다', () => {
    const now = new Date('2026-07-31T09:00:00.000Z')
    const result = calculateLessonStartTimes(
      '2026-07-31',
      [
        {
          joinedAt: '2026-07-31T08:50:00.000Z',
          estimatedStartAt: '2026-07-31T09:10:00.000Z', // 아직 시작 전
        },
      ],
      now,
    )

    expect(result).toEqual(['2026-07-31T09:00:00.000Z'])
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

describe('레슨 운영 시간 (월수금 17-20시 KST)', () => {
  it('월요일 18시는 레슨 시간이다', () => {
    // 2026-08-03 = 월요일, 18:00 KST = 09:00 UTC
    expect(isLessonTime(new Date('2026-08-03T09:00:00.000Z'))).toBe(true)
  })

  it('월요일 17시 정각부터 가능하다', () => {
    expect(isLessonTime(new Date('2026-08-03T08:00:00.000Z'))).toBe(true)
  })

  it('월요일 16시 59분은 레슨 시간이 아니다', () => {
    expect(isLessonTime(new Date('2026-08-03T07:59:00.000Z'))).toBe(false)
  })

  it('월요일 20시 이후는 레슨 시간이 아니다', () => {
    expect(isLessonTime(new Date('2026-08-03T11:00:00.000Z'))).toBe(false)
  })

  it('화요일은 레슨 시간이 아니다', () => {
    // 2026-08-04 = 화요일, 18:00 KST
    expect(isLessonTime(new Date('2026-08-04T09:00:00.000Z'))).toBe(false)
  })

  it('수요일과 금요일 저녁은 레슨 시간이다', () => {
    expect(isLessonTime(new Date('2026-08-05T10:30:00.000Z'))).toBe(true)
    expect(isLessonTime(new Date('2026-08-07T08:30:00.000Z'))).toBe(true)
  })
})
