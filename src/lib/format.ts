const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const shortDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

const fullDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

export function formatTime(value: string | Date): string {
  return timeFormatter.format(typeof value === 'string' ? new Date(value) : value)
}

export function formatShortDate(value: string | Date): string {
  return shortDateFormatter.format(typeof value === 'string' ? new Date(value) : value)
}

export function formatFullDate(value: string | Date): string {
  return fullDateFormatter.format(typeof value === 'string' ? new Date(value) : value)
}

export function toSeoulDateKey(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

export function formatWaitTime(value: string | null): string {
  if (!value) return '첫 게임 대기'

  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  )

  if (minutes < 1) return '방금 참여'
  if (minutes < 60) return `${minutes}분 대기`
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 대기`
}

export function formatExperience(months: number): string {
  if (months < 12) return `${months}개월`

  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest ? `${years}년 ${rest}개월` : `${years}년`
}

export function genderLabel(gender: 'male' | 'female' | 'unspecified'): string {
  if (gender === 'male') return '남성'
  if (gender === 'female') return '여성'
  return '미지정'
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean(
      (window.navigator as Navigator & { standalone?: boolean }).standalone,
    )
  )
}
