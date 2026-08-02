import {
  Check,
  ChevronRight,
  CircleDot,
  Gamepad2,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Trophy,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CourtMap } from '../components/CourtMap'
import { MemberDetailModal } from '../components/MemberDetailModal'
import { ShuttlecockIcon } from '../components/ShuttlecockIcon'
import { EmptyState, PageHeader } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatExperience, formatWaitTime } from '../lib/format'
import { buildAutoArrangement } from '../lib/gameMatching'
import {
  LESSON_COURT,
  gameSlotCapacity,
  type AutoArrangement,
  type CommunityMember,
  type CourtName,
  type GameSlot,
  type GameType,
  type Team,
} from '../types'

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

function TeamColumn({
  team,
  slot,
  busy,
  onRemoveGuest,
}: {
  team: Team
  slot: GameSlot
  busy: boolean
  onRemoveGuest?: (playerId: string) => void
}) {
  const players = slot.players.filter((player) => player.team === team)
  const seats = gameSlotCapacity(slot.gameType ?? 'doubles') / 2
  return (
    <div className={`team-column team-${team.toLowerCase()}`}>
      <div className="team-title">
        <span>팀 {team}</span>
        {slot.result && (
          <strong>
            {team === 'A' ? slot.result.teamAScore : slot.result.teamBScore}
          </strong>
        )}
      </div>
      {Array.from({ length: seats }, (_, index) => {
        const player = players[index]
        return player ? (
          <div
            className={`player-chip${player.isGuest ? ' guest' : ''}`}
            key={player.id}
          >
            <span>{player.nickname.slice(0, 1)}</span>
            <strong>{player.nickname}</strong>
            {player.isGuest && <em className="guest-tag">게스트</em>}
            {player.isGuest && slot.status === 'open' && onRemoveGuest && (
              <button
                className="chip-remove"
                type="button"
                aria-label={`게스트 ${player.nickname} 제외`}
                disabled={busy}
                onClick={() => onRemoveGuest(player.id)}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ) : (
          <div className="player-chip empty" key={`empty-${team}-${index}`}>
            <span>
              <Plus size={12} />
            </span>
            <strong>빈 자리</strong>
          </div>
        )
      })}
    </div>
  )
}

function SlotCard({
  slot,
  memberId,
  busy,
  onJoinRequest,
  onLeave,
  onStart,
  onComplete,
  onDeleteRequest,
  onAddGuest,
  onRemoveGuest,
}: {
  slot: GameSlot
  memberId: string
  busy: boolean
  onJoinRequest: (slot: GameSlot) => void
  onLeave: () => void
  onStart: () => void
  onComplete: (teamAScore: number, teamBScore: number) => void
  onDeleteRequest: () => void
  onAddGuest?: (guestName: string) => void
  onRemoveGuest?: (playerId: string) => void
}) {
  const [teamAScore, setTeamAScore] = useState(
    String(slot.result?.teamAScore ?? 21),
  )
  const [teamBScore, setTeamBScore] = useState(
    String(slot.result?.teamBScore ?? 15),
  )
  const [editingResult, setEditingResult] = useState(false)
  const [guestFormOpen, setGuestFormOpen] = useState(false)
  const [guestName, setGuestName] = useState('')
  const mine = slot.players.some((player) => player.memberId === memberId)
  const capacity = gameSlotCapacity(slot.gameType ?? 'doubles')
  const isFull = slot.players.length >= capacity

  const submitScore = (event: FormEvent) => {
    event.preventDefault()
    onComplete(Number(teamAScore), Number(teamBScore))
    setEditingResult(false)
  }

  const submitGuest = (event: FormEvent) => {
    event.preventDefault()
    if (!guestName.trim() || !onAddGuest) return
    onAddGuest(guestName.trim())
    setGuestName('')
    setGuestFormOpen(false)
  }

  return (
    <article className={`game-slot-card ${slot.status}`}>
      <div className="slot-head">
        <div className="slot-head-info">
          <strong>{slot.courtName}</strong>
          <span className="lozenge">
            {slot.gameType === 'singles' ? '단식' : '복식'}
          </span>
          <span
            className={`lozenge ${
              slot.status === 'playing'
                ? 'warning'
                : slot.status === 'completed'
                  ? 'success'
                  : 'inprogress'
            }`}
          >
            {slot.status === 'open' &&
              `모집중 ${slot.players.length}/${capacity}`}
            {slot.status === 'playing' && '게임중'}
            {slot.status === 'completed' && '종료'}
          </span>
          {slot.source === 'auto' && <span className="lozenge">자동 배치</span>}
        </div>
        {(slot.status === 'open' || slot.status === 'playing') && (
          <button
            className="icon-button small danger"
            type="button"
            aria-label="게임 삭제"
            disabled={busy}
            onClick={onDeleteRequest}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="versus-grid">
        <TeamColumn
          team="A"
          slot={slot}
          busy={busy}
          onRemoveGuest={onRemoveGuest}
        />
        <div className="versus-mark">VS</div>
        <TeamColumn
          team="B"
          slot={slot}
          busy={busy}
          onRemoveGuest={onRemoveGuest}
        />
      </div>

      {slot.status === 'open' && (
        <div className="slot-actions">
          {mine ? (
            <button
              className="button subtle"
              type="button"
              disabled={busy}
              onClick={onLeave}
            >
              <UserMinus size={14} />
              나가기
            </button>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={busy || isFull}
              onClick={() => onJoinRequest(slot)}
            >
              <UserPlus size={14} />
              {isFull ? '모집 완료' : '게임 참여'}
            </button>
          )}
          {onAddGuest && (
            <button
              className="button subtle"
              type="button"
              disabled={busy || isFull}
              onClick={() => setGuestFormOpen((open) => !open)}
            >
              <UserPlus size={14} />
              게스트 추가
            </button>
          )}
          <button
            className="button subtle"
            type="button"
            disabled={busy || !isFull}
            onClick={onStart}
          >
            <Gamepad2 size={14} />
            게임 시작
          </button>
        </div>
      )}

      {slot.status === 'open' && guestFormOpen && onAddGuest && (
        <form className="guest-form" onSubmit={submitGuest}>
          <input
            required
            maxLength={20}
            placeholder="게스트 이름"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
          />
          <button className="button primary" type="submit" disabled={busy}>
            추가
          </button>
          <button
            className="button subtle"
            type="button"
            onClick={() => setGuestFormOpen(false)}
          >
            취소
          </button>
        </form>
      )}

      {slot.status === 'completed' && !editingResult && (
        <div className="slot-actions end">
          <button
            className="button subtle"
            type="button"
            disabled={busy}
            onClick={() => setEditingResult(true)}
          >
            <Pencil size={13} />
            점수 수정
          </button>
        </div>
      )}

      {(slot.status === 'playing' || editingResult) && (
        <form className="score-form" onSubmit={submitScore}>
          <label>
            <span>팀 A</span>
            <input
              type="number"
              min="0"
              max="99"
              required
              value={teamAScore}
              onChange={(event) => setTeamAScore(event.target.value)}
            />
          </label>
          <span className="score-colon">:</span>
          <label>
            <span>팀 B</span>
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
            <Trophy size={14} />
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
    <section className="panel auto-panel">
      <div className="panel-head">
        <h2>
          <Sparkles size={15} />
          {arrangement.courtName} 자동 배치 제안
        </h2>
        <button
          className="icon-button small"
          type="button"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <p className="auto-explanation">{arrangement.explanation}</p>
      <div className="auto-teams">
        {(['A', 'B'] as const).map((team) => (
          <div className="auto-team" key={team}>
            <div className="auto-team-title">
              <strong>팀 {team}</strong>
              <span>
                예상 전력{' '}
                {team === 'A' ? arrangement.teamAScore : arrangement.teamBScore}
              </span>
            </div>
            {arrangement.candidates
              .filter((candidate) => candidate.team === team)
              .map((candidate) => (
                <div className="auto-candidate" key={candidate.memberId}>
                  <strong>{candidate.nickname}</strong>
                  <small>{candidate.reason}</small>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="panel-actions">
        <button className="button subtle" type="button" onClick={onRefresh}>
          <RefreshCcw size={14} />
          다시 추천
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          <Check size={14} />
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
    addGuestPlayer,
    removeGuestPlayer,
    startGameSlot,
    completeGameSlot,
    cancelGameSlot,
    confirmAutoArrangement,
  } = useApp()
  const now = useNow()
  const [selectedCourt, setSelectedCourt] = useState<CourtName | null>(null)
  const [newGameType, setNewGameType] = useState<GameType>('doubles')
  const [lessonCourtConfirm, setLessonCourtConfirm] =
    useState<CourtName | null>(null)
  const [joinConfirm, setJoinConfirm] = useState<{
    slotId: string
    nth: number
  } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<GameSlot | null>(null)
  const [detailMember, setDetailMember] = useState<CommunityMember | null>(
    null,
  )
  const [arrangement, setArrangement] = useState<AutoArrangement | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)

  if (!snapshot) return null
  const { game, member, community } = snapshot
  const busy = Boolean(busyAction?.startsWith('game-'))

  const activeAttendees = game.attendees.filter((attendee) => attendee.active)
  const activeSlots = game.slots.filter(
    (slot) => slot.status === 'open' || slot.status === 'playing',
  )
  const completedSlots = game.slots.filter(
    (slot) => slot.status === 'completed',
  )
  const myAttendance = game.attendees.find(
    (attendee) => attendee.memberId === member.id,
  )
  const myOccupied = activeSlots.some((slot) =>
    slot.players.some((player) => player.memberId === member.id),
  )
  const selectedCourtBusy = selectedCourt
    ? activeSlots.some((slot) => slot.courtName === selectedCourt)
    : false

  const orderedAttendees = [...activeAttendees].sort((a, b) => {
    if (a.canJoin !== b.canJoin) return a.canJoin ? -1 : 1
    if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed
    return a.nickname.localeCompare(b.nickname, 'ko')
  })

  const openMemberDetail = (memberId: string) => {
    const found = community.members.find(
      (communityMember) => communityMember.memberId === memberId,
    )
    if (found) setDetailMember(found)
  }

  const handleCourtSelect = (court: CourtName) => {
    if (court === selectedCourt) {
      setSelectedCourt(null)
      return
    }
    if (court === LESSON_COURT) {
      setLessonCourtConfirm(court)
      return
    }
    setSelectedCourt(court)
  }

  const requestJoin = (slot: GameSlot) => {
    if (!game.myAttendanceActive) return
    if (myOccupied) return
    if (myAttendance && !myAttendance.canJoin) {
      const joinedToday = game.slots.filter((item) =>
        item.players.some((player) => player.memberId === member.id),
      ).length
      setJoinConfirm({ slotId: slot.id, nth: joinedToday + 1 })
      return
    }
    void joinGameSlot(slot.id)
  }

  const generateAuto = () => {
    if (!selectedCourt || selectedCourtBusy) {
      setAutoError('먼저 배치도에서 비어 있는 코트를 선택해 주세요.')
      return
    }
    if (newGameType === 'singles') {
      setAutoError('자동 배치는 복식 게임에서만 사용할 수 있습니다.')
      return
    }
    const next = buildAutoArrangement(
      game.attendees,
      game.currentCycle,
      selectedCourt,
    )
    setArrangement(next)
    setAutoError(
      next
        ? null
        : '이번 순환에서 참여 가능한 회원이 4명 필요합니다. 자동 배치는 순환 순서를 지키는 회원만 선택합니다.',
    )
  }

  const createManual = async () => {
    if (!selectedCourt || selectedCourtBusy) {
      setAutoError('먼저 배치도에서 비어 있는 코트를 선택해 주세요.')
      return
    }
    setAutoError(null)
    await createGameSlot(selectedCourt, newGameType)
    setSelectedCourt(null)
    setNewGameType('doubles')
  }

  const confirmAuto = async () => {
    if (!arrangement) return
    await confirmAutoArrangement(arrangement)
    setArrangement(null)
    setSelectedCourt(null)
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="게임"
        description={`현재 ${game.currentCycle}번째 순환 · 참석 ${activeAttendees.length}명 · 진행 슬롯 ${activeSlots.length}개`}
        action={
          <button
            className={`button ${
              game.myAttendanceActive ? 'danger-soft' : 'accent attention'
            }`}
            type="button"
            disabled={busyAction === 'game-attendance'}
            onClick={() => void setGameAttendance(!game.myAttendanceActive)}
          >
            {game.myAttendanceActive ? (
              <CircleDot size={14} />
            ) : (
              <ShuttlecockIcon size={14} />
            )}
            {game.myAttendanceActive ? '참석 종료' : '게임 참석'}
          </button>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <h2>코트 현황</h2>
          <div className="court-legend">
            <span className="legend-item free">사용 가능</span>
            <span className="legend-item open">모집중</span>
            <span className="legend-item playing">게임중</span>
          </div>
        </div>
        <CourtMap
          slots={game.slots}
          now={now}
          selectedCourt={selectedCourt}
          onSelectCourt={handleCourtSelect}
        />
        <div className="court-create-row">
          <p className="court-create-hint">
            {selectedCourt
              ? `${selectedCourt} 선택됨 - 게임 방식을 선택하세요.`
              : '비어 있는 코트를 눌러 새 게임을 만들 수 있습니다.'}
          </p>
          {selectedCourt && (
            <div
              className="segmented game-type-segmented"
              role="radiogroup"
              aria-label="게임 방식"
            >
              <button
                type="button"
                role="radio"
                aria-checked={newGameType === 'doubles'}
                className={newGameType === 'doubles' ? 'active' : ''}
                onClick={() => setNewGameType('doubles')}
              >
                복식 2:2
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={newGameType === 'singles'}
                className={newGameType === 'singles' ? 'active' : ''}
                onClick={() => setNewGameType('singles')}
              >
                단식 1:1
              </button>
            </div>
          )}
          <div className="court-create-actions">
            <button
              className="button primary"
              type="button"
              disabled={busy || !selectedCourt || selectedCourtBusy}
              onClick={() => void createManual()}
            >
              <Plus size={14} />
              자율 게임 만들기
            </button>
            <button
              className="button subtle"
              type="button"
              disabled={
                busy ||
                !selectedCourt ||
                selectedCourtBusy ||
                newGameType === 'singles'
              }
              onClick={generateAuto}
            >
              <Sparkles size={14} />
              자동 배치
            </button>
          </div>
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

      <div className="game-columns">
        <section className="panel">
          <div className="panel-head">
            <h2>진행 중인 게임</h2>
            <span className="panel-count">{activeSlots.length}</span>
          </div>
          {activeSlots.length ? (
            <div className="slot-list">
              {activeSlots.map((slot) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  memberId={member.id}
                  busy={busy}
                  onJoinRequest={requestJoin}
                  onLeave={() => void leaveGameSlot(slot.id)}
                  onStart={() => void startGameSlot(slot.id)}
                  onComplete={(a, b) => void completeGameSlot(slot.id, a, b)}
                  onDeleteRequest={() => setDeleteConfirm(slot)}
                  onAddGuest={(guestName) =>
                    void addGuestPlayer(slot.id, guestName)
                  }
                  onRemoveGuest={(playerId) =>
                    void removeGuestPlayer(slot.id, playerId)
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Gamepad2}
              title="열린 게임이 없습니다"
              description="배치도에서 코트를 선택해 게임을 만들어 보세요."
            />
          )}

          {completedSlots.length > 0 && (
            <>
              <div className="panel-head sub">
                <h2>오늘 완료</h2>
                <span className="panel-count">{completedSlots.length}</span>
              </div>
              <div className="slot-list">
                {completedSlots.slice(0, 3).map((slot) => (
                  <SlotCard
                    key={slot.id}
                    slot={slot}
                    memberId={member.id}
                    busy={busy}
                    onJoinRequest={() => undefined}
                    onLeave={() => undefined}
                    onStart={() => undefined}
                    onComplete={(a, b) => void completeGameSlot(slot.id, a, b)}
                    onDeleteRequest={() => undefined}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>오늘의 참석자</h2>
            <span className="panel-count">{orderedAttendees.length}</span>
          </div>
          {orderedAttendees.length ? (
            <ul className="attendee-list">
              {orderedAttendees.map((attendee) => (
                <li key={attendee.id}>
                  <button
                    type="button"
                    className="attendee-row"
                    onClick={() => openMemberDetail(attendee.memberId)}
                  >
                    <Avatar
                      name={attendee.nickname}
                      url={attendee.avatarUrl}
                      size={32}
                    />
                    <span className="attendee-name">
                      {attendee.nickname}
                      {attendee.memberId === member.id && (
                        <em className="me-tag">나</em>
                      )}
                    </span>
                    <span className="attendee-meta">
                      구력 {formatExperience(attendee.experienceMonths)} ·{' '}
                      {attendee.gamesPlayed}게임 ·{' '}
                      {formatWaitTime(attendee.lastGameAt)}
                    </span>
                    <span
                      className={`lozenge ${attendee.canJoin ? 'success' : ''}`}
                    >
                      {attendee.canJoin ? '차례' : '대기'}
                    </span>
                    <ChevronRight size={14} className="attendee-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CircleDot}
              title="아직 참석자가 없습니다"
              description="오늘 게임 참석 버튼을 눌러 첫 번째로 참여해 보세요."
            />
          )}
        </section>
      </div>

      <MemberDetailModal
        member={detailMember}
        onClose={() => setDetailMember(null)}
      />

      <ConfirmDialog
        open={lessonCourtConfirm !== null}
        title="레슨 코트 안내"
        message="이 코트는 레슨 코트입니다. 레슨이 없는 경우에만 사용 가능합니다. 계속하시겠습니까?"
        confirmLabel="사용하기"
        onConfirm={() => {
          if (lessonCourtConfirm) setSelectedCourt(lessonCourtConfirm)
          setLessonCourtConfirm(null)
        }}
        onCancel={() => setLessonCourtConfirm(null)}
      />

      <ConfirmDialog
        open={joinConfirm !== null}
        title="순환 순서 안내"
        message={`현재 ${joinConfirm?.nth ?? 0}번째 게임 참여입니다. (현재 순환 ${game.currentCycle}회) 아직 순환하지 않은 회원이 있습니다. 그래도 참여하시겠습니까?`}
        confirmLabel="참여하기"
        busy={busy}
        onConfirm={() => {
          if (joinConfirm) void joinGameSlot(joinConfirm.slotId)
          setJoinConfirm(null)
        }}
        onCancel={() => setJoinConfirm(null)}
      />

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="게임 삭제"
        message={
          deleteConfirm
            ? `${deleteConfirm.courtName}의 ${
                deleteConfirm.status === 'playing' ? '진행 중인 ' : ''
              }게임을 삭제할까요? 참여자들은 다시 다른 게임에 참여할 수 있게 됩니다.`
            : ''
        }
        confirmLabel="삭제"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          if (deleteConfirm) void cancelGameSlot(deleteConfirm.id)
          setDeleteConfirm(null)
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}
