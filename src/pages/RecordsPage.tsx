import { CalendarCheck2, Handshake, TrendingUp, Trophy } from 'lucide-react'
import { EmptyState, PageHeader } from '../components/ui'
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
        title="기록"
        description="레슨 참석과 게임 전적을 모아 확인하세요."
      />

      <div className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">
            <CalendarCheck2 size={13} />
            이번 달 레슨
          </span>
          <strong>{lesson.monthlyCount}회</strong>
          <small>취소 제외</small>
        </article>
        <article className="stat-card">
          <span className="stat-label">
            <Trophy size={13} />
            전체 전적
          </span>
          <strong>
            {records.wins}승 {records.losses}패
          </strong>
          <small>{records.games}게임</small>
        </article>
        <article className="stat-card">
          <span className="stat-label">
            <TrendingUp size={13} />
            승률
          </span>
          <strong>{records.games ? `${winRate}%` : '—'}</strong>
          <small>
            {records.games ? '기록된 게임 기준' : '첫 게임을 기다려요'}
          </small>
        </article>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Handshake size={15} />
            파트너별 전적
          </h2>
          <span className="panel-count">{records.partnerStats.length}</span>
        </div>

        {records.partnerStats.length ? (
          <div className="partner-table">
            <div className="partner-table-head">
              <span>파트너</span>
              <span>게임</span>
              <span>승-패</span>
              <span>승률</span>
              <span>마지막 경기</span>
            </div>
            {records.partnerStats.map((partner) => (
              <div className="partner-table-row" key={partner.memberId}>
                <span className="partner-name">{partner.nickname}</span>
                <span>{partner.games}</span>
                <span>
                  {partner.wins}-{partner.losses}
                </span>
                <span className="partner-rate">
                  <i style={{ width: `${partner.winRate}%` }} />
                  <em>{partner.winRate}%</em>
                </span>
                <span className="partner-date">
                  {formatShortDate(partner.lastPlayedAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Handshake}
            title="아직 파트너 전적이 없어요"
            description="복식 게임 전적을 저장하면 파트너별 승리 기록이 집계됩니다."
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Trophy size={15} />
            최근 게임
          </h2>
          <span className="panel-count">{myGames.length}</span>
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
                    player.team === mine?.team &&
                    player.memberId !== member.id,
                )
                .map((player) => player.nickname)
                .join(', ')
              return (
                <article className="record-row" key={slot.id}>
                  <span className={`result-mark ${didWin ? 'win' : 'loss'}`}>
                    {didWin ? '승' : '패'}
                  </span>
                  <span className="record-detail">
                    <strong>{slot.courtName}</strong>
                    <small>파트너 {teammates || '—'}</small>
                  </span>
                  <span className="record-score">
                    <strong>
                      {slot.result?.teamAScore} : {slot.result?.teamBScore}
                    </strong>
                    <small>{formatShortDate(slot.createdAt)}</small>
                  </span>
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
