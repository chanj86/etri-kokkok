import {
  BellRing,
  CalendarDays,
  Check,
  Clock3,
  LogOut,
  MoveDown,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, PageHeader } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatShortDate, formatTime } from '../lib/format'
import { LESSON_DURATION_MINUTES, minutesUntil } from '../lib/lessonSchedule'

const LESSON_MS = LESSON_DURATION_MINUTES * 60_000

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

  if (!snapshot) return null
  const { lesson } = snapshot
  const waitMinutes = lesson.myBooking
    ? minutesUntil(lesson.myBooking.estimatedStartAt, new Date(now))
    : null
  const myLessonInProgress = lesson.myBooking
    ? isInProgress(lesson.myBooking.estimatedStartAt, now)
    : false

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={formatShortDate(`${lesson.sessionDate}T12:00:00+09:00`)}
        title="레슨"
        description="도착 순서대로 1인 15분씩 배정됩니다. 17시 이후 참석할 수 있습니다."
        action={
          !lesson.myBooking ? (
            <button
              className="button primary"
              type="button"
              disabled={!lesson.canJoin || busyAction === 'lesson-join'}
              onClick={() => void joinLesson()}
            >
              <Check size={14} />
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
