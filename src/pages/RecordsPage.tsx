import {
  CalendarCheck2,
  Medal,
  Minus,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { EmptyState, PageHeader, StatCard, StatusPill } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatShortDate } from '../lib/format'

export function RecordsPage() {
  const { snapshot } = useApp()
  if (!snapshot) return null

  const { member, records, game, lesson } = snapshot
  const winRate = records.games
    ? Math.round((records.wins / records.games) * 100)
    : 0
  const myGames = game.slots.filter(
    (slot) =>
      slot.status === 'completed' &&
      slot.players.some((player) => player.memberId === member.id),
  )

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="꾸준함이 실력이 되는 곳"
        title="나의 기록"
        description="레슨 참석과 게임 전적을 모아 확인하세요."
      />

      <div className="stats-grid records-stats">
        <StatCard
          icon={CalendarCheck2}
          label="이번 달 레슨"
          value={`${lesson.monthlyCount}회`}
          helper="취소 제외"
        />
        <StatCard
          icon={Trophy}
          label="전체 전적"
          value={`${records.wins}승 ${records.losses}패`}
          helper={`${records.games}게임`}
        />
        <StatCard
          icon={TrendingUp}
          label="승률"
          value={`${winRate}%`}
          helper={records.games ? '기록된 게임 기준' : '첫 게임을 기다려요'}
        />
      </div>

      <section className="surface-card progress-card">
        <div className="progress-copy">
          <div
            className="progress-ring"
            style={
              { '--progress': `${winRate * 3.6}deg` } as CSSProperties
            }
          >
            <div>
              <strong>{winRate}%</strong>
              <span>승률</span>
            </div>
          </div>
          <div>
            <span className="section-kicker">게임 밸런스</span>
            <h2>
              {records.games === 0
                ? '첫 전적을 기록해 보세요'
                : winRate >= 60
                  ? '좋은 흐름을 이어가고 있어요'
                  : '다음 게임에서 반전을 노려보세요'}
            </h2>
            <p>자동 배치는 전적이 아닌 구력과 레슨 기록으로 팀 균형을 맞춥니다.</p>
          </div>
        </div>
        <div className="record-breakdown">
          <div className="win">
            <Medal size={18} />
            <span>승리</span>
            <strong>{records.wins}</strong>
          </div>
          <div className="loss">
            <Minus size={18} />
            <span>패배</span>
            <strong>{records.losses}</strong>
          </div>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-heading compact">
          <div>
            <span className="section-kicker">저장된 전적</span>
            <h2>최근 게임</h2>
          </div>
          <StatusPill tone="neutral">{myGames.length}건</StatusPill>
        </div>

        {myGames.length ? (
          <div className="record-list">
            {myGames.map((slot) => {
              const mine = slot.players.find(
                (player) => player.memberId === member.id,
              )
              const didWin = mine?.team === slot.result?.winnerTeam
              const teammates = slot.players
                .filter(
                  (player) =>
                    player.team === mine?.team && player.memberId !== member.id,
                )
                .map((player) => player.nickname)
                .join(', ')
              return (
                <article className="record-row" key={slot.id}>
                  <div className={`result-mark ${didWin ? 'win' : 'loss'}`}>
                    {didWin ? 'W' : 'L'}
                  </div>
                  <div className="record-detail">
                    <strong>{slot.courtName}</strong>
                    <span>
                      TEAM {mine?.team} · 파트너 {teammates || '—'}
                    </span>
                  </div>
                  <div className="record-score">
                    <strong>
                      {slot.result?.teamAScore} : {slot.result?.teamBScore}
                    </strong>
                    <small>{formatShortDate(slot.createdAt)}</small>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={Trophy}
            title="아직 저장된 전적이 없어요"
            description="게임을 종료하고 점수를 입력하면 개인 기록에 자동 반영됩니다."
          />
        )}
      </section>
    </div>
  )
}
