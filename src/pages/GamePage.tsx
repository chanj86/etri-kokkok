import {
  Bot,
  Check,
  CircleDot,
  Clock3,
  Gamepad2,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Trophy,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatWaitTime } from '../lib/format'
import { buildAutoArrangement } from '../lib/gameMatching'
import type {
  AutoArrangement,
  GameSlot,
  Team,
} from '../types'

function TeamList({
  team,
  slot,
}: {
  team: Team
  slot: GameSlot
}) {
  const players = slot.players.filter((player) => player.team === team)
  return (
    <div className={`team-column team-${team.toLowerCase()}`}>
      <div className="team-title">
        <span>TEAM {team}</span>
        {slot.result && (
          <strong>
            {team === 'A' ? slot.result.teamAScore : slot.result.teamBScore}
          </strong>
        )}
      </div>
      {[0, 1].map((index) => {
        const player = players[index]
        return player ? (
          <div className="player-chip" key={player.id}>
            <span>{player.nickname.slice(0, 1)}</span>
            <div>
              <strong>{player.nickname}</strong>
              <small>밸런스 {Math.round(player.skillScore)}</small>
            </div>
          </div>
        ) : (
          <div className="player-chip empty" key={`empty-${team}-${index}`}>
            <span>
              <Plus size={15} />
            </span>
            <div>
              <strong>빈 자리</strong>
              <small>참여 가능</small>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SlotCard({
  slot,
  memberId,
  canJoin,
  attendanceActive,
  busy,
  onJoin,
  onLeave,
  onStart,
  onComplete,
}: {
  slot: GameSlot
  memberId: string
  canJoin: boolean
  attendanceActive: boolean
  busy: boolean
  onJoin: () => void
  onLeave: () => void
  onStart: () => void
  onComplete: (teamAScore: number, teamBScore: number) => void
}) {
  const [teamAScore, setTeamAScore] = useState(
    String(slot.result?.teamAScore ?? 21),
  )
  const [teamBScore, setTeamBScore] = useState(
    String(slot.result?.teamBScore ?? 15),
  )
  const [editingResult, setEditingResult] = useState(false)
  const mine = slot.players.some((player) => player.memberId === memberId)
  const isFull = slot.players.length === 4

  const submitScore = (event: FormEvent) => {
    event.preventDefault()
    onComplete(Number(teamAScore), Number(teamBScore))
    setEditingResult(false)
  }

  return (
    <article className={`game-slot-card ${slot.status}`}>
      <div className="slot-head">
        <div>
          <span className="section-kicker">{slot.courtName}</span>
          <h3>
            {slot.status === 'open' && `${slot.players.length}/4명 모집 중`}
            {slot.status === 'playing' && '게임 진행 중'}
            {slot.status === 'completed' && '게임 종료'}
          </h3>
        </div>
        <StatusPill
          tone={
            slot.status === 'playing'
              ? 'warning'
              : slot.status === 'completed'
                ? 'success'
                : 'accent'
          }
        >
          {slot.source === 'auto' ? '자동 배치' : '자율 참여'}
        </StatusPill>
      </div>

      <div className="versus-grid">
        <TeamList team="A" slot={slot} />
        <div className="versus-mark">VS</div>
        <TeamList team="B" slot={slot} />
      </div>

      {slot.status === 'open' && (
        <div className="slot-actions">
          {mine ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={onLeave}
            >
              <UserMinus size={18} />
              슬롯 나가기
            </button>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={busy || !attendanceActive || !canJoin || isFull}
              onClick={onJoin}
            >
              <UserPlus size={18} />
              {!attendanceActive
                ? '먼저 게임 참석'
                : !canJoin
                  ? '순환 대기 중'
                  : isFull
                    ? '모집 완료'
                    : '게임 참여'}
            </button>
          )}
          <button
            className="button dark"
            type="button"
            disabled={busy || !isFull}
            onClick={onStart}
          >
            <Gamepad2 size={18} />
            게임 시작
          </button>
        </div>
      )}

      {slot.status === 'completed' && !editingResult && (
        <div className="completed-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => setEditingResult(true)}
          >
            <Pencil size={16} />
            점수 수정
          </button>
        </div>
      )}

      {(slot.status === 'playing' || editingResult) && (
        <form className="score-form" onSubmit={submitScore}>
          <label>
            <span>A팀</span>
            <input
              type="number"
              min="0"
              max="99"
              required
              value={teamAScore}
              onChange={(event) => setTeamAScore(event.target.value)}
            />
          </label>
          <span>:</span>
          <label>
            <span>B팀</span>
            <input
              type="number"
              min="0"
              max="99"
              required
              value={teamBScore}
              onChange={(event) => setTeamBScore(event.target.value)}
            />
          </label>
          <button className="button primary" type="submit" disabled={busy}>
            <Trophy size={18} />
            {slot.status === 'completed' ? '수정 저장' : '전적 저장'}
          </button>
        </form>
      )}
    </article>
  )
}

function AutoArrangementPanel({
  arrangement,
  busy,
  onClose,
  onRefresh,
  onConfirm,
}: {
  arrangement: AutoArrangement
  busy: boolean
  onClose: () => void
  onRefresh: () => void
  onConfirm: () => void
}) {
  return (
    <section className="auto-panel">
      <div className="auto-panel-head">
        <div className="auto-icon">
          <Bot size={23} />
        </div>
        <div>
          <span className="section-kicker">설명 가능한 추천</span>
          <h2>{arrangement.courtName} 자동 배치</h2>
        </div>
        <button className="icon-button" type="button" aria-label="닫기" onClick={onClose}>
          <X size={19} />
        </button>
      </div>

      <p className="auto-explanation">{arrangement.explanation}</p>
      <div className="auto-teams">
        {(['A', 'B'] as const).map((team) => (
          <div key={team}>
            <div className="auto-team-title">
              <strong>TEAM {team}</strong>
              <span>
                예상 {team === 'A' ? arrangement.teamAScore : arrangement.teamBScore}
              </span>
            </div>
            {arrangement.candidates
              .filter((candidate) => candidate.team === team)
              .map((candidate) => (
                <div className="auto-candidate" key={candidate.memberId}>
                  <span>{candidate.nickname.slice(0, 1)}</span>
                  <div>
                    <strong>{candidate.nickname}</strong>
                    <small>{candidate.reason}</small>
                  </div>
                  <em>{Math.round(candidate.skillScore)}</em>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="auto-actions">
        <button className="button secondary" type="button" onClick={onRefresh}>
          <RefreshCcw size={18} />
          다시 추천
        </button>
        <button className="button lime" type="button" disabled={busy} onClick={onConfirm}>
          <Check size={18} />
          이 배치로 확정
        </button>
      </div>
    </section>
  )
}

export function GamePage() {
  const {
    snapshot,
    busyAction,
    setGameAttendance,
    createGameSlot,
    joinGameSlot,
    leaveGameSlot,
    startGameSlot,
    completeGameSlot,
    confirmAutoArrangement,
  } = useApp()
  const [courtNumber, setCourtNumber] = useState(1)
  const [arrangement, setArrangement] = useState<AutoArrangement | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)

  if (!snapshot) return null
  const { game, member } = snapshot
  const activeAttendees = game.attendees.filter((attendee) => attendee.active)
  const activeSlots = game.slots.filter(
    (slot) => slot.status === 'open' || slot.status === 'playing',
  )
  const completedSlots = game.slots.filter(
    (slot) => slot.status === 'completed',
  )
  const busy = Boolean(busyAction?.startsWith('game-'))

  const orderedAttendees = [...activeAttendees].sort((a, b) => {
    if (a.canJoin !== b.canJoin) return a.canJoin ? -1 : 1
    if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed
    return a.nickname.localeCompare(b.nickname, 'ko')
  })

  const generateAuto = () => {
    const next = buildAutoArrangement(
      game.attendees,
      game.currentCycle,
      `${courtNumber}번 코트`,
    )
    setArrangement(next)
    setAutoError(
      next
        ? null
        : '현재 순환에서 참여 가능한 회원이 4명 필요합니다. 남은 회원이 먼저 참여하면 다음 순환이 열립니다.',
    )
  }

  const createSlot = async () => {
    await createGameSlot(`${courtNumber}번 코트`)
    setCourtNumber((number) => number + 1)
  }

  const confirmAuto = async () => {
    if (!arrangement) return
    await confirmAutoArrangement(arrangement)
    setArrangement(null)
    setAutoError(null)
    setCourtNumber((number) => number + 1)
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="복식 4인 기준"
        title="게임 참여"
        description="빈 슬롯을 직접 선택하거나 공정한 자동 배치를 이용하세요."
        action={
          <button
            className={`button ${game.myAttendanceActive ? 'secondary' : 'primary'}`}
            type="button"
            disabled={busyAction === 'game-attendance'}
            onClick={() => void setGameAttendance(!game.myAttendanceActive)}
          >
            <CircleDot size={18} />
            {game.myAttendanceActive ? '참석 중 · 종료' : '오늘 게임 참석'}
          </button>
        }
      />

      <section className="cycle-board">
        <div className="cycle-number">
          <span>현재 순환</span>
          <strong>{game.currentCycle}</strong>
          <em>ROUND</em>
        </div>
        <div className="cycle-copy">
          <div>
            <StatusPill tone={game.myCanJoin ? 'success' : 'warning'}>
              {game.myCanJoin ? '지금 참여 가능' : '다른 회원 순환 대기'}
            </StatusPill>
            <h2>
              {game.myAttendanceActive
                ? game.myCanJoin
                  ? '빈 슬롯에 참여할 수 있어요'
                  : '한 바퀴가 끝나면 다시 열려요'
                : '게임 참석을 먼저 눌러 주세요'}
            </h2>
          </div>
          <div className="cycle-stats">
            <div>
              <UsersRound size={19} />
              <span>참석</span>
              <strong>{activeAttendees.length}명</strong>
            </div>
            <div>
              <Gamepad2 size={19} />
              <span>활성 슬롯</span>
              <strong>{activeSlots.length}개</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card attendee-board">
        <div className="section-heading compact">
          <div>
            <span className="section-kicker">순환 현황</span>
            <h2>오늘의 참석자</h2>
          </div>
          <span className="legend">
            <i />
            참여 가능
          </span>
        </div>
        <div className="attendee-list">
          {orderedAttendees.map((attendee, index) => (
            <div
              className={`attendee-item ${attendee.canJoin ? 'eligible' : 'waiting'}`}
              key={attendee.id}
            >
              <span className="attendee-order">{index + 1}</span>
              <div className="avatar">{attendee.nickname.slice(0, 1)}</div>
              <div>
                <strong>
                  {attendee.nickname}
                  {attendee.memberId === member.id && <em>나</em>}
                </strong>
                <small>
                  {attendee.gamesPlayed}게임 · {formatWaitTime(attendee.lastGameAt)}
                </small>
              </div>
              <StatusPill tone={attendee.canJoin ? 'success' : 'neutral'}>
                {attendee.canJoin ? '가능' : '대기'}
              </StatusPill>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">코트 열기</span>
            <h2>새 게임 만들기</h2>
          </div>
          <div className="court-picker">
            <button
              type="button"
              aria-label="코트 번호 줄이기"
              onClick={() => setCourtNumber((number) => Math.max(1, number - 1))}
            >
              −
            </button>
            <strong>{courtNumber}번 코트</strong>
            <button
              type="button"
              aria-label="코트 번호 늘리기"
              onClick={() => setCourtNumber((number) => number + 1)}
            >
              +
            </button>
          </div>
        </div>
        <div className="create-game-grid">
          <button
            className="create-game-card manual"
            type="button"
            disabled={busy}
            onClick={() => void createSlot()}
          >
            <div>
              <Plus size={23} />
            </div>
            <strong>자율 참여 슬롯</strong>
            <span>회원들이 직접 4자리를 채워요</span>
          </button>
          <button
            className="create-game-card auto"
            type="button"
            disabled={busy}
            onClick={generateAuto}
          >
            <div>
              <Sparkles size={23} />
            </div>
            <strong>자동 균형 배치</strong>
            <span>대기와 실력을 고려해 추천해요</span>
          </button>
        </div>
        {autoError && <p className="inline-error">{autoError}</p>}
      </section>

      {arrangement && (
        <AutoArrangementPanel
          arrangement={arrangement}
          busy={busy}
          onClose={() => setArrangement(null)}
          onRefresh={generateAuto}
          onConfirm={() => void confirmAuto()}
        />
      )}

      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">실시간 코트</span>
            <h2>열린 게임</h2>
          </div>
          <StatusPill tone="accent">{activeSlots.length}개</StatusPill>
        </div>
        {activeSlots.length ? (
          <div className="slot-grid">
            {activeSlots.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                memberId={member.id}
                canJoin={game.myCanJoin}
                attendanceActive={game.myAttendanceActive}
                busy={busy}
                onJoin={() => void joinGameSlot(slot.id)}
                onLeave={() => void leaveGameSlot(slot.id)}
                onStart={() => void startGameSlot(slot.id)}
                onComplete={(a, b) => void completeGameSlot(slot.id, a, b)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Gamepad2}
            title="아직 열린 게임이 없어요"
            description="새 자율 참여 슬롯을 만들거나 자동 배치를 시작해 보세요."
          />
        )}
      </section>

      {completedSlots.length > 0 && (
        <section>
          <div className="section-heading">
            <div>
              <span className="section-kicker">오늘 완료</span>
              <h2>최근 게임</h2>
            </div>
            <Clock3 size={20} />
          </div>
          <div className="slot-grid">
            {completedSlots.slice(0, 2).map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                memberId={member.id}
                canJoin={false}
                attendanceActive={game.myAttendanceActive}
                busy={busy}
                onJoin={() => undefined}
                onLeave={() => undefined}
                onStart={() => undefined}
                onComplete={(a, b) => void completeGameSlot(slot.id, a, b)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
