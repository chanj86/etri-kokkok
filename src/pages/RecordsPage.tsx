import {
  CalendarCheck2,
  Handshake,
  Medal,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { MemberDetailModal } from '../components/MemberDetailModal'
import { EmptyState, PageHeader } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatShortDate } from '../lib/format'
import type { CommunityMember, TeamRanking } from '../types'

type RecordsTab = 'me' | 'individual' | 'team'

function winRateOf(games: number, wins: number): number {
  return games ? Math.round((wins / games) * 100) : 0
}

// 승수 → 승률 → 게임 수 순으로 순위를 매긴다.
function rankIndividuals(members: CommunityMember[]): CommunityMember[] {
  return [...members].sort(
    (a, b) =>
      b.wins - a.wins ||
      winRateOf(b.games, b.wins) - winRateOf(a.games, a.wins) ||
      b.games - a.games ||
      a.nickname.localeCompare(b.nickname, 'ko'),
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span className={`rank-badge top-${rank}`}>
        <Medal size={12} />
        {rank}
      </span>
    )
  }
  return <span className="rank-badge">{rank}</span>
}

export function RecordsPage() {
  const { snapshot } = useApp()
  const [tab, setTab] = useState<RecordsTab>(() => {
    const param = new URLSearchParams(window.location.search).get('tab')
    return param === 'individual' || param === 'team' ? param : 'me'
  })
  const [selectedMember, setSelectedMember] = useState<CommunityMember | null>(
    null,
  )

  if (!snapshot) return null

  const { member, records, game, lesson, community } = snapshot
  const winRate = records.games
    ? Math.round((records.wins / records.games) * 100)
    : 0
  const myGames = game.slots.filter(
    (slot) =>
      slot.status === 'completed' &&
      slot.players.some((player) => player.memberId === member.id),
  )
  const individualRankings = rankIndividuals(community.members)
  const teamRankings: TeamRanking[] = community.teamRankings

  const tabs: Array<{ id: RecordsTab; label: string }> = [
    { id: 'me', label: '내 기록' },
    { id: 'individual', label: '개인 랭킹' },
    { id: 'team', label: '팀 랭킹' },
  ]

  return (
    <div className="page-stack">
      <PageHeader
        title="기록"
        description="내 전적과 동호회 전체 랭킹을 확인하세요."
      />

      <div className="segmented" role="tablist" aria-label="기록 메뉴">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'me' && (
        <>
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
                      <span
                        className={`result-mark ${didWin ? 'win' : 'loss'}`}
                      >
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
        </>
      )}

      {tab === 'individual' && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              <Trophy size={15} />
              개인 랭킹
            </h2>
            <span className="panel-count">{individualRankings.length}</span>
          </div>
          <p className="ranking-hint">
            승수가 많은 순으로, 같으면 승률이 높은 순으로 정렬합니다.
          </p>

          {individualRankings.length ? (
            <div className="ranking-table">
              <div className="ranking-table-head">
                <span>순위</span>
                <span>회원</span>
                <span>게임</span>
                <span>승-패</span>
                <span>승률</span>
              </div>
              {individualRankings.map((entry, index) => (
                <button
                  type="button"
                  className={`ranking-table-row${
                    entry.memberId === member.id ? ' mine' : ''
                  }`}
                  key={entry.memberId}
                  onClick={() => setSelectedMember(entry)}
                >
                  <RankBadge rank={index + 1} />
                  <span className="ranking-member">
                    <Avatar
                      name={entry.nickname}
                      url={entry.avatarUrl}
                      size={26}
                    />
                    <span className="ranking-name">
                      {entry.nickname}
                      {entry.memberId === member.id && (
                        <em className="me-tag">나</em>
                      )}
                    </span>
                  </span>
                  <span>{entry.games}</span>
                  <span>
                    {entry.wins}-{entry.losses}
                  </span>
                  <span className="ranking-rate">
                    {entry.games ? `${winRateOf(entry.games, entry.wins)}%` : '—'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="랭킹을 만들 회원이 없어요"
              description="회원들이 게임 전적을 쌓으면 자동으로 순위가 매겨집니다."
            />
          )}
        </section>
      )}

      {tab === 'team' && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              <Handshake size={15} />
              팀 랭킹
            </h2>
            <span className="panel-count">{teamRankings.length}</span>
          </div>
          <p className="ranking-hint">
            같은 팀으로 뛴 2인 조합의 전적입니다. 승수 순, 같으면 승률 순입니다.
          </p>

          {teamRankings.length ? (
            <div className="ranking-table team">
              <div className="ranking-table-head">
                <span>순위</span>
                <span>팀</span>
                <span>게임</span>
                <span>승-패</span>
                <span>승률</span>
              </div>
              {teamRankings.map((team, index) => {
                const isMyTeam =
                  team.memberAId === member.id || team.memberBId === member.id
                return (
                  <div
                    className={`ranking-table-row${isMyTeam ? ' mine' : ''}`}
                    key={`${team.memberAId}-${team.memberBId}`}
                  >
                    <RankBadge rank={index + 1} />
                    <span className="ranking-member">
                      <span className="ranking-avatar-pair">
                        <Avatar
                          name={team.memberANickname}
                          url={team.memberAAvatarUrl}
                          size={26}
                        />
                        <Avatar
                          name={team.memberBNickname}
                          url={team.memberBAvatarUrl}
                          size={26}
                        />
                      </span>
                      <span className="ranking-name">
                        {team.memberANickname} · {team.memberBNickname}
                      </span>
                    </span>
                    <span>{team.games}</span>
                    <span>
                      {team.wins}-{team.losses}
                    </span>
                    <span className="ranking-rate">
                      {winRateOf(team.games, team.wins)}%
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState
              icon={Handshake}
              title="아직 팀 전적이 없어요"
              description="복식 게임을 완료하면 함께 뛴 조합별 순위가 집계됩니다."
            />
          )}
        </section>
      )}

      <MemberDetailModal
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
      />
    </div>
  )
}
