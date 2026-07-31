import {
  BellRing,
  CalendarDays,
  Check,
  Clock3,
  LogOut,
  MoveDown,
  UsersRound,
} from 'lucide-react'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatShortDate, formatTime } from '../lib/format'
import { minutesUntil } from '../lib/lessonSchedule'

export function LessonPage() {
  const {
    snapshot,
    busyAction,
    joinLesson,
    delayLesson,
    cancelLesson,
    enableNotifications,
  } = useApp()

  if (!snapshot) return null
  const { lesson } = snapshot
  const waitMinutes = lesson.myBooking
    ? minutesUntil(lesson.myBooking.estimatedStartAt)
    : null

  const confirmCancel = () => {
    if (
      window.confirm(
        '오늘 레슨 참석을 취소할까요? 취소하면 월별 참석 횟수에서도 제외됩니다.',
      )
    ) {
      void cancelLesson()
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={formatShortDate(`${lesson.sessionDate}T12:00:00+09:00`)}
        title="레슨 순서"
        description="서버에 기록된 도착 순서대로 15분씩 배정됩니다."
        action={
          <StatusPill tone="success">
            <span className="live-dot" />
            실시간
          </StatusPill>
        }
      />

      {lesson.myBooking ? (
        <section className="my-lesson-card">
          <div className="my-lesson-main">
            <div className="lesson-number-badge">
              <span>순서</span>
              <strong>{lesson.myBooking.position}</strong>
            </div>
            <div>
              <span className="section-kicker">나의 예상 레슨</span>
              <h2>{formatTime(lesson.myBooking.estimatedStartAt)}</h2>
              <p>
                {waitMinutes !== null && waitMinutes > 0
                  ? `약 ${waitMinutes}분 후 시작해요`
                  : '곧 레슨이 시작돼요'}
              </p>
            </div>
          </div>
          <div className="my-lesson-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busyAction === 'lesson-delay'}
              onClick={() => void delayLesson()}
            >
              <MoveDown size={18} />
              맨 뒤로 미루기
            </button>
            <button
              className="button text-danger"
              type="button"
              disabled={busyAction === 'lesson-cancel'}
              onClick={confirmCancel}
            >
              <LogOut size={18} />
              참석 취소
            </button>
          </div>
        </section>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="아직 레슨에 참석하지 않았어요"
          description="코트에 도착한 뒤 참석 버튼을 누르면 현재 대기열 끝에 등록됩니다."
          action={
            <button
              className="button primary"
              type="button"
              disabled={!lesson.canJoin || busyAction === 'lesson-join'}
              onClick={() => void joinLesson()}
            >
              <Check size={18} />
              레슨 참석
            </button>
          }
        />
      )}

      <section className="surface-card queue-card">
        <div className="section-heading compact">
          <div>
            <span className="section-kicker">현재 대기열</span>
            <h2>{lesson.queue.length}명 참석</h2>
          </div>
          <div className="queue-duration">
            <Clock3 size={17} />
            1인 15분
          </div>
        </div>

        {lesson.queue.length ? (
          <ol className="lesson-queue">
            {lesson.queue.map((booking) => (
              <li
                key={booking.id}
                className={booking.isMine ? 'mine' : undefined}
              >
                <div className="queue-position">{booking.position}</div>
                <div className="queue-person">
                  <strong>
                    {booking.nickname}
                    {booking.isMine && <span>나</span>}
                  </strong>
                  <small>{formatTime(booking.joinedAt)} 도착</small>
                </div>
                <time>{formatTime(booking.estimatedStartAt)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={UsersRound}
            title="첫 번째 순서를 기다리고 있어요"
            description="오늘 가장 먼저 레슨에 참석해 보세요."
          />
        )}
      </section>

      <section className="lesson-note-grid">
        <article className="info-note">
          <div className="info-note-icon">
            <BellRing size={20} />
          </div>
          <div>
            <strong>15분 전 알림</strong>
            <p>순서 변경을 반영한 최신 예상 시각을 기준으로 알려드려요.</p>
          </div>
          <button
            type="button"
            disabled={busyAction === 'enable-notifications'}
            onClick={() => void enableNotifications()}
          >
            켜기
          </button>
        </article>
        <article className="info-note muted">
          <div className="info-note-icon">
            <CalendarDays size={20} />
          </div>
          <div>
            <strong>이번 달 {lesson.monthlyCount}회</strong>
            <p>취소한 참석은 월별 횟수에서 자동으로 제외됩니다.</p>
          </div>
        </article>
      </section>
    </div>
  )
}
