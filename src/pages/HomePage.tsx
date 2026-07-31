import {
  ArrowRight,
  CalendarCheck2,
  Clock3,
  Gamepad2,
  Medal,
  Trophy,
  UsersRound,
} from 'lucide-react'
import { AppLink } from '../components/AppLink'
import { InstallCard } from '../components/InstallCard'
import { PageHeader, StatCard, StatusPill } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatFullDate, formatTime } from '../lib/format'
import { minutesUntil } from '../lib/lessonSchedule'

export function HomePage() {
  const {
    snapshot,
    busyAction,
    joinLesson,
    setGameAttendance,
  } = useApp()

  if (!snapshot) return null

  const { lesson, game, records } = snapshot
  const waitMinutes = lesson.myBooking
    ? minutesUntil(lesson.myBooking.estimatedStartAt)
    : null
  const playingSlots = game.slots.filter(
    (slot) => slot.status === 'open' || slot.status === 'playing',
  ).length

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={formatFullDate(new Date())}
        title="오늘도 즐거운 콕!"
        description="내 순서와 코트 상황을 한눈에 확인하세요."
      />

      <section className="etri-welcome-banner">
        <div className="etri-welcome-copy">
          <img src="/etri-logo.png" alt="ETRI" />
          <div>
            <span className="section-kicker">ETRI 콕콕</span>
            <h2>함께 기다리고, 함께 즐겨요</h2>
            <p>ETRI 캐릭터와 함께 오늘의 레슨과 게임을 시작해 보세요.</p>
          </div>
        </div>
        <img
          className="etri-welcome-characters"
          src="/etri-characters.png"
          alt="ETRI 캐릭터"
        />
      </section>

      <section className="home-hero-grid">
        <article className="lesson-hero">
          <div className="card-topline">
            <div className="icon-chip light">
              <CalendarCheck2 size={20} />
            </div>
            <StatusPill tone={lesson.myBooking ? 'accent' : 'neutral'}>
              {lesson.myBooking ? '참석 완료' : '참석 전'}
            </StatusPill>
          </div>

          {lesson.myBooking ? (
            <>
              <div className="lesson-position">
                <span>나의 레슨 순서</span>
                <strong>{lesson.myBooking.position}</strong>
                <em>번째</em>
              </div>
              <div className="lesson-time-row">
                <Clock3 size={19} />
                <div>
                  <span>예상 시작</span>
                  <strong>{formatTime(lesson.myBooking.estimatedStartAt)}</strong>
                </div>
                <small>
                  {waitMinutes !== null && waitMinutes > 0
                    ? `약 ${waitMinutes}분 후`
                    : '곧 시작'}
                </small>
              </div>
              <AppLink className="card-link light-link" to="/lesson">
                대기열 자세히 보기
                <ArrowRight size={18} />
              </AppLink>
            </>
          ) : (
            <div className="hero-empty">
              <div>
                <h2>코트에 도착하셨나요?</h2>
                <p>17시 이후 참석하면 도착 순서대로 시간이 배정됩니다.</p>
              </div>
              <button
                className="button lime"
                type="button"
                disabled={!lesson.canJoin || busyAction === 'lesson-join'}
                onClick={() => void joinLesson()}
              >
                레슨 참석
                <ArrowRight size={18} />
              </button>
            </div>
          )}
        </article>

        <article className="game-hero">
          <div className="game-hero-head">
            <div>
              <span className="section-kicker">오늘의 게임</span>
              <h2>{game.currentCycle}번째 순환</h2>
            </div>
            <div className="cycle-orbit" aria-hidden="true">
              <span>{game.currentCycle}</span>
            </div>
          </div>
          <div className="game-quick-stats">
            <div>
              <UsersRound size={18} />
              <span>참석 {game.attendees.filter((item) => item.active).length}명</span>
            </div>
            <div>
              <Gamepad2 size={18} />
              <span>진행 슬롯 {playingSlots}개</span>
            </div>
          </div>
          <div className="game-hero-actions">
            <button
              className={`button ${game.myAttendanceActive ? 'ghost-dark' : 'primary'}`}
              type="button"
              disabled={busyAction === 'game-attendance'}
              onClick={() => void setGameAttendance(!game.myAttendanceActive)}
            >
              {game.myAttendanceActive ? '참석 중' : '게임 참석'}
            </button>
            <AppLink className="round-link" to="/game" aria-label="게임 화면 열기">
              <ArrowRight size={20} />
            </AppLink>
          </div>
        </article>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">이번 달 기록</span>
            <h2>나의 활동</h2>
          </div>
          <AppLink to="/records">전체 기록</AppLink>
        </div>
        <div className="stats-grid">
          <StatCard
            icon={CalendarCheck2}
            label="레슨 참석"
            value={`${records.lessonsThisMonth}회`}
            helper="이번 달"
          />
          <StatCard
            icon={Trophy}
            label="게임 승리"
            value={`${records.wins}승`}
            helper={`${records.losses}패`}
          />
          <StatCard
            icon={Medal}
            label="승률"
            value={
              records.games
                ? `${Math.round((records.wins / records.games) * 100)}%`
                : '—'
            }
            helper={`${records.games}게임`}
          />
        </div>
      </section>

      <InstallCard />
    </div>
  )
}
