import {
  ArrowRight,
  CalendarCheck2,
  ChevronRight,
  CircleDot,
  Clock3,
  Gamepad2,
  Megaphone,
  Trophy,
} from 'lucide-react'
import { AppLink } from '../components/AppLink'
import { InstallCard } from '../components/InstallCard'
import { PageHeader } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { navigate } from '../lib/navigation'
import { formatFullDate, formatShortDate, formatTime } from '../lib/format'
import { minutesUntil } from '../lib/lessonSchedule'

export function HomePage() {
  const { snapshot, busyAction, joinLesson, setGameAttendance } = useApp()

  if (!snapshot) return null

  const { lesson, game, records, community, member } = snapshot
  const waitMinutes = lesson.myBooking
    ? minutesUntil(lesson.myBooking.estimatedStartAt)
    : null
  const activeSlots = game.slots.filter(
    (slot) => slot.status === 'open' || slot.status === 'playing',
  ).length
  const attendeeCount = game.attendees.filter(
    (attendee) => attendee.active,
  ).length
  const latestNotices = community.notices.slice(0, 2)
  const winRate = records.games
    ? Math.round((records.wins / records.games) * 100)
    : null

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={formatFullDate(new Date())}
        title={`${member.nickname}님, 안녕하세요`}
        description="오늘의 레슨 순서와 코트 현황을 확인하세요."
      />

      <section className="panel notice-panel">
        <div className="panel-head">
          <h2>
            <Megaphone size={15} />
            공지사항
          </h2>
          <AppLink to="/community" className="panel-link">
            더보기
            <ChevronRight size={13} />
          </AppLink>
        </div>
        {latestNotices.length ? (
          <ul className="notice-list">
            {latestNotices.map((notice) => (
              <li key={notice.id}>
                <button
                  type="button"
                  className="notice-row"
                  onClick={() => navigate('/community')}
                >
                  <strong>{notice.title}</strong>
                  <span>{formatShortDate(notice.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notice-empty">등록된 공지가 없습니다.</p>
        )}
      </section>

      <div className="home-grid">
        <section className="panel home-card">
          <div className="panel-head">
            <h2>
              <CalendarCheck2 size={15} />
              오늘의 레슨
            </h2>
            <AppLink to="/lesson" className="panel-link">
              대기열
              <ChevronRight size={13} />
            </AppLink>
          </div>

          {lesson.myBooking ? (
            <div className="home-lesson-status">
              <div className="home-lesson-order">
                <strong>{lesson.myBooking.position}</strong>
                <span>번째</span>
              </div>
              <div className="home-lesson-time">
                <span>
                  <Clock3 size={13} />
                  예상 {formatTime(lesson.myBooking.estimatedStartAt)}
                </span>
                <small>
                  {waitMinutes !== null && waitMinutes > 0
                    ? `약 ${waitMinutes}분 후 시작`
                    : '곧 시작합니다'}
                </small>
              </div>
            </div>
          ) : (
            <div className="home-card-cta">
              <p>17시 이후 코트에 도착했다면 참석을 눌러 주세요.</p>
              <button
                className="button primary"
                type="button"
                disabled={!lesson.canJoin || busyAction === 'lesson-join'}
                onClick={() => void joinLesson()}
              >
                레슨 참석
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <p className="home-card-foot">
            이번 달 레슨 {lesson.monthlyCount}회 참석
          </p>
        </section>

        <section className="panel home-card">
          <div className="panel-head">
            <h2>
              <Gamepad2 size={15} />
              오늘의 게임
            </h2>
            <AppLink to="/game" className="panel-link">
              코트 현황
              <ChevronRight size={13} />
            </AppLink>
          </div>

          <div className="home-game-stats">
            <div>
              <span>순환</span>
              <strong>{game.currentCycle}회</strong>
            </div>
            <div>
              <span>참석</span>
              <strong>{attendeeCount}명</strong>
            </div>
            <div>
              <span>진행 게임</span>
              <strong>{activeSlots}개</strong>
            </div>
          </div>

          <button
            className={`button ${game.myAttendanceActive ? 'subtle' : 'primary'} home-game-button`}
            type="button"
            disabled={busyAction === 'game-attendance'}
            onClick={() => void setGameAttendance(!game.myAttendanceActive)}
          >
            <CircleDot size={14} />
            {game.myAttendanceActive ? '게임 참석 중 · 종료하기' : '오늘 게임 참석'}
          </button>
        </section>

        <section className="panel home-card">
          <div className="panel-head">
            <h2>
              <Trophy size={15} />
              나의 기록
            </h2>
            <AppLink to="/records" className="panel-link">
              전체
              <ChevronRight size={13} />
            </AppLink>
          </div>
          <div className="home-game-stats">
            <div>
              <span>전적</span>
              <strong>
                {records.wins}승 {records.losses}패
              </strong>
            </div>
            <div>
              <span>승률</span>
              <strong>{winRate === null ? '—' : `${winRate}%`}</strong>
            </div>
            <div>
              <span>게임</span>
              <strong>{records.games}회</strong>
            </div>
          </div>
        </section>
      </div>

      <InstallCard />
    </div>
  )
}
