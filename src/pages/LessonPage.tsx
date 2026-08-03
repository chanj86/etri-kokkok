import {
  BellRing,
  CalendarDays,
  Clock3,
  LogOut,
  MoveDown,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ShuttlecockIcon } from '../components/ShuttlecockIcon'
import { EmptyState, PageHeader } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatTime, toSeoulDateKey } from '../lib/format'
import {
  LESSON_DURATION_MINUTES,
  LESSON_TIME_MESSAGE,
  isLessonTime,
  minutesUntil,
} from '../lib/lessonSchedule'

const LESSON_MS = LESSON_DURATION_MINUTES * 60_000
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

function isInProgress(estimatedStartAt: string, now: number): boolean {
  const start = new Date(estimatedStartAt).getTime()
  return start <= now && now < start + LESSON_MS
}

export function LessonPage() {
  const {
    snapshot,
    busyAction,
    joinLesson,
    delayLesson,
    cancelLesson,
    enableNotifications,
  } = useApp()
  const now = useNow()
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [timeAlert, setTimeAlert] = useState(false)

  const handleJoin = () => {
    if (!isLessonTime()) {
      setTimeAlert(true)
      return
    }
    void joinLesson()
  }

  if (!snapshot) return null
  const { lesson } = snapshot
  const waitMinutes = lesson.myBooking
    ? minutesUntil(lesson.myBooking.estimatedStartAt, new Date(now))
    : null
  const myLessonInProgress = lesson.myBooking
    ? isInProgress(lesson.myBooking.estimatedStartAt, now)
    : false

  // 이번 달 달력: 참석한 날에 동그라미 표시
  const todayKey = toSeoulDateKey()
  const calendarYear = Number(todayKey.slice(0, 4))
  const calendarMonth = Number(todayKey.slice(5, 7))
  const todayDay = Number(todayKey.slice(8, 10))
  const attendedDays = new Set(
    lesson.monthlyDates
      .filter((dateKey) => dateKey.slice(0, 7) === todayKey.slice(0, 7))
      .map((dateKey) => Number(dateKey.slice(8, 10))),
  )
  const firstWeekday = new Date(calendarYear, calendarMonth - 1, 1).getDay()
  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate()
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]

  return (
    <div className="page-stack">
      <PageHeader
        title="레슨"
        description="도착 순서대로 1인 15분씩 배정됩니다. 월·수·금 17:00-20:00에 참석할 수 있습니다."
        action={
          !lesson.myBooking ? (
            <button
              className={`button primary${lesson.canJoin ? ' attention' : ''}`}
              type="button"
              disabled={busyAction === 'lesson-join'}
              onClick={handleJoin}
            >
              <ShuttlecockIcon size={14} />
              레슨 참석
            </button>
          ) : undefined
        }
      />

      {lesson.myBooking && (
        <section className="panel my-lesson-card">
          <div className="my-lesson-main">
            <div className="lesson-number-badge">
              <span>내 순서</span>
              <strong>{lesson.myBooking.position}</strong>
            </div>
            <div className="my-lesson-info">
              <h2>
                {myLessonInProgress
                  ? '레슨 진행 중'
                  : `${formatTime(lesson.myBooking.estimatedStartAt)} 예상`}
              </h2>
              <p>
                {myLessonInProgress
                  ? '지금 내 레슨 시간이에요'
                  : waitMinutes !== null && waitMinutes > 0
                    ? `약 ${waitMinutes}분 후 시작해요`
                    : '곧 레슨이 시작돼요'}
              </p>
            </div>
          </div>
          <div className="my-lesson-actions">
            <button
              className="button subtle"
              type="button"
              disabled={busyAction === 'lesson-delay'}
              onClick={() => void delayLesson()}
            >
              <MoveDown size={14} />
              맨 뒤로 미루기
            </button>
            <button
              className="button subtle danger-text"
              type="button"
              disabled={busyAction === 'lesson-cancel'}
              onClick={() => setCancelConfirm(true)}
            >
              <LogOut size={14} />
              참석 취소
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Clock3 size={15} />
            현재 대기열
          </h2>
          <span className="panel-count">{lesson.queue.length}</span>
        </div>

        {lesson.queue.length ? (
          <ol className="lesson-queue">
            {lesson.queue.map((booking) => {
              const inProgress = isInProgress(booking.estimatedStartAt, now)
              return (
                <li
                  key={booking.id}
                  className={booking.isMine ? 'mine' : undefined}
                >
                  <span className="queue-position">{booking.position}</span>
                  <span className="queue-person">
                    {booking.nickname}
                    {booking.isMine && <em className="me-tag">나</em>}
                    {inProgress && <em className="lozenge info">레슨 중</em>}
                  </span>
                  <span className="queue-joined">
                    {formatTime(booking.joinedAt)} 도착
                  </span>
                  <time className="queue-eta">
                    {inProgress
                      ? `${formatTime(booking.estimatedStartAt)} 시작`
                      : formatTime(booking.estimatedStartAt)}
                  </time>
                </li>
              )
            })}
          </ol>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="아직 참석자가 없습니다"
            description="오늘 가장 먼저 레슨에 참석해 보세요."
          />
        )}
      </section>

      <section className="panel notice-strip">
        <div className="notice-strip-copy">
          <BellRing size={15} />
          <div>
            <strong>레슨 알림</strong>
            <p>
              15분 전과 5분 전에 알려드리고, 예상 시각이 바뀌면 즉시
              알려드립니다. 이번 달 {lesson.monthlyCount}회 참석했습니다.
            </p>
          </div>
        </div>
        <button
          className="button subtle"
          type="button"
          disabled={busyAction === 'enable-notifications'}
          onClick={() => void enableNotifications()}
        >
          알림 켜기
        </button>
      </section>

      <section className="panel lesson-calendar">
        <div className="panel-head">
          <h2>
            <CalendarDays size={15} />
            {calendarMonth}월 참여 이력
          </h2>
          <span className="panel-count">{lesson.monthlyCount}회</span>
        </div>
        <div
          className="calendar-grid"
          role="img"
          aria-label={`이번 달 레슨 ${lesson.monthlyCount}회 참석`}
        >
          {WEEKDAY_LABELS.map((weekday) => (
            <span className="calendar-weekday" key={weekday}>
              {weekday}
            </span>
          ))}
          {calendarCells.map((day, index) =>
            day === null ? (
              <span className="calendar-day empty" key={`empty-${index}`} />
            ) : (
              <span
                key={day}
                className={`calendar-day${
                  attendedDays.has(day) ? ' attended' : ''
                }${day === todayDay ? ' today' : ''}`}
              >
                {day}
              </span>
            ),
          )}
        </div>
      </section>

      <ConfirmDialog
        open={timeAlert}
        title="레슨 시간 안내"
        message={LESSON_TIME_MESSAGE}
        confirmLabel="확인"
        hideCancel
        onConfirm={() => setTimeAlert(false)}
        onCancel={() => setTimeAlert(false)}
      />

      <ConfirmDialog
        open={cancelConfirm}
        title="레슨 참석 취소"
        message="오늘 레슨 참석을 취소할까요? 취소하면 월별 참석 횟수에서도 제외됩니다."
        confirmLabel="참석 취소"
        tone="danger"
        busy={busyAction === 'lesson-cancel'}
        onConfirm={() => {
          setCancelConfirm(false)
          void cancelLesson()
        }}
        onCancel={() => setCancelConfirm(false)}
      />
    </div>
  )
}
