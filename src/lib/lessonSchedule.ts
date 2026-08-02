export const LESSON_DURATION_MINUTES = 15

const LESSON_MS = LESSON_DURATION_MINUTES * 60_000

export function lessonOpensAt(sessionDate: string): Date {
  return new Date(`${sessionDate}T17:00:00+09:00`)
}

export interface LessonQueueEntry {
  joinedAt: string
  /** 현재 저장된 예상 시각 (진행 중 여부 판정에 사용) */
  estimatedStartAt?: string
}

/**
 * 서버(resequence_lesson_queue)와 같은 규칙으로 대기열 시간을 계산한다.
 * - 진행 중인 레슨(예정 시각이 지났지만 15분 이내)은 시작 시각을 유지한다.
 * - 다음 사람은 앞사람 종료 시각부터 15분씩 이어 배정한다.
 * - 시간이 당겨져도 현재 시각보다 이르게 잡지 않는다.
 */
export function calculateLessonStartTimes(
  sessionDate: string,
  entries: LessonQueueEntry[],
  now = new Date(),
): string[] {
  const nowMs = now.getTime()
  let chainEnd = lessonOpensAt(sessionDate).getTime()

  return entries.map((entry) => {
    const joined = new Date(entry.joinedAt).getTime()
    const previous = entry.estimatedStartAt
      ? new Date(entry.estimatedStartAt).getTime()
      : Number.NaN
    let start = Math.max(chainEnd, joined)

    if (start < nowMs) {
      const inProgress =
        Number.isFinite(previous) && previous <= nowMs && nowMs < previous + LESSON_MS
      start = inProgress ? previous : nowMs
    }

    chainEnd = start + LESSON_MS
    return new Date(start).toISOString()
  })
}

export function minutesUntil(value: string, now = new Date()): number {
  return Math.ceil((new Date(value).getTime() - now.getTime()) / 60_000)
}
