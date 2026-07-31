export const LESSON_DURATION_MINUTES = 15

export function lessonOpensAt(sessionDate: string): Date {
  return new Date(`${sessionDate}T17:00:00+09:00`)
}

export function calculateLessonStartTimes(
  sessionDate: string,
  joinedAtValues: string[],
): string[] {
  if (joinedAtValues.length === 0) return []

  const openTime = lessonOpensAt(sessionDate).getTime()
  const firstJoinTime = new Date(joinedAtValues[0]).getTime()
  const firstStartTime = Math.max(openTime, firstJoinTime)

  return joinedAtValues.map((_, index) =>
    new Date(
      firstStartTime + index * LESSON_DURATION_MINUTES * 60_000,
    ).toISOString(),
  )
}

export function minutesUntil(value: string, now = new Date()): number {
  return Math.ceil((new Date(value).getTime() - now.getTime()) / 60_000)
}
