import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  authenticateWithPhone,
  communityApi,
  enablePushNotifications,
  fetchSnapshot,
  gameApi,
  lessonApi,
  subscribeToClubChanges,
  updateProfile,
  uploadAvatarPhoto,
} from '../lib/api'
import { createDemoSnapshot } from '../lib/demoData'
import { toSeoulDateKey } from '../lib/format'
import { calculateSkillScore } from '../lib/gameMatching'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  gameSlotCapacity,
  type AppSnapshot,
  type AuthInput,
  type AutoArrangement,
  type GamePlayer,
  type GameSnapshot,
  type GameType,
  type MatchingPostInput,
  type Post,
  type PostCategory,
  type ProfileInput,
  type RecordSummary,
} from '../types'
import { AppContext, type AppNotice } from './appContext'

const MINUTE = 60_000

function actionError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('Failed to fetch')) {
      return '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.'
    }
    return error.message
  }
  return '요청을 처리하지 못했습니다.'
}

const LESSON_MS = 15 * MINUTE

// 서버와 같은 규칙으로 대기열 시간을 잇는다:
// 진행 중인 레슨은 시작 시각을 유지하고, 다음 사람은 앞사람 종료 시각부터
// 15분씩 이어 배정한다. 시간이 당겨져도 현재 시각보다 이르게 잡지 않는다.
function refreshLessonQueue(snapshot: AppSnapshot): AppSnapshot {
  const now = Date.now()
  const activeQueue = snapshot.lesson.queue.filter(
    (booking) => booking.status === 'waiting',
  )

  let chainEnd = Number.NEGATIVE_INFINITY
  const queue = activeQueue.map((booking, index) => {
    const joined = new Date(booking.joinedAt).getTime()
    const previous = new Date(booking.estimatedStartAt).getTime()
    let start = Math.max(chainEnd, joined)
    if (start < now) {
      const inProgress = previous <= now && now < previous + LESSON_MS
      start = inProgress ? previous : now
    }
    chainEnd = start + LESSON_MS
    return {
      ...booking,
      position: index + 1,
      estimatedStartAt: new Date(start).toISOString(),
    }
  })
  const myBooking =
    queue.find((booking) => booking.memberId === snapshot.member.id) ?? null

  return {
    ...snapshot,
    lesson: {
      ...snapshot.lesson,
      queue,
      myBooking,
    },
  }
}

function withGameEligibility(
  snapshot: AppSnapshot,
  game: GameSnapshot = snapshot.game,
): AppSnapshot {
  const occupiedMembers = new Set(
    game.slots
      .filter((slot) => slot.status === 'open' || slot.status === 'playing')
      .flatMap((slot) => slot.players.map((player) => player.memberId)),
  )
  const attendees = game.attendees.map((attendee) => ({
    ...attendee,
    canJoin:
      attendee.active &&
      attendee.lastJoinedCycle < game.currentCycle &&
      !occupiedMembers.has(attendee.memberId),
  }))
  const mine = attendees.find(
    (attendee) => attendee.memberId === snapshot.member.id,
  )

  return {
    ...snapshot,
    game: {
      ...game,
      attendees,
      myAttendanceActive: Boolean(mine?.active),
      myCanJoin: Boolean(mine?.canJoin),
    },
  }
}

function advanceCycleIfComplete(game: GameSnapshot): GameSnapshot {
  const activeAttendees = game.attendees.filter((attendee) => attendee.active)
  if (
    activeAttendees.length > 0 &&
    activeAttendees.every(
      (attendee) => attendee.lastJoinedCycle >= game.currentCycle,
    )
  ) {
    return { ...game, currentCycle: game.currentCycle + 1 }
  }
  return game
}

function updateDemoPartnerRecord(
  records: RecordSummary,
  teammate: GamePlayer | undefined,
  isFirstCompletion: boolean,
  didWin: boolean,
  previouslyWon: boolean,
  playedAt: string,
): RecordSummary {
  // 게스트 파트너는 회원 전적에 집계하지 않는다.
  if (
    !teammate ||
    teammate.memberId === null ||
    (!isFirstCompletion && previouslyWon === didWin)
  ) {
    return records
  }
  const teammateMemberId = teammate.memberId

  const existing = records.partnerStats.find(
    (partner) => partner.memberId === teammateMemberId,
  )
  const games = existing?.games ?? 0
  const wins = existing?.wins ?? 0
  const losses = existing?.losses ?? 0
  const nextGames = games + (isFirstCompletion ? 1 : 0)
  const nextWins = isFirstCompletion
    ? wins + (didWin ? 1 : 0)
    : wins + (didWin ? 1 : -1)
  const nextLosses = isFirstCompletion
    ? losses + (didWin ? 0 : 1)
    : losses + (didWin ? -1 : 1)
  const nextPartner = {
    memberId: teammateMemberId,
    nickname: teammate.nickname,
    games: nextGames,
    wins: nextWins,
    losses: nextLosses,
    winRate: nextGames ? Math.round((nextWins / nextGames) * 100) : 0,
    lastPlayedAt: isFirstCompletion
      ? playedAt
      : (existing?.lastPlayedAt ?? playedAt),
  }
  const partnerStats = [
    ...records.partnerStats.filter(
      (partner) => partner.memberId !== teammateMemberId,
    ),
    nextPartner,
  ].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.games - a.games ||
      a.nickname.localeCompare(b.nickname, 'ko'),
  )

  return { ...records, partnerStats }
}

export function AppProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(!supabase)
  const [demoMode, setDemoMode] = useState(false)
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<AppNotice | null>(null)

  const loadRemoteSnapshot = useCallback(async () => {
    const nextSnapshot = await fetchSnapshot()
    setSnapshot(nextSnapshot)
  }, [])

  useEffect(() => {
    let active = true

    if (!supabase) {
      return
    }

    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return
      if (error) {
        setNotice({ type: 'error', message: actionError(error) })
      } else if (data.session) {
        try {
          await loadRemoteSnapshot()
        } catch (snapshotError) {
          setNotice({ type: 'error', message: actionError(snapshotError) })
        }
      }
      if (active) setReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'SIGNED_OUT' || !session) {
        setSnapshot(null)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [loadRemoteSnapshot])

  useEffect(() => {
    if (demoMode || !snapshot || !isSupabaseConfigured) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeToClubChanges(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void loadRemoteSnapshot().catch((error: unknown) => {
          setNotice({ type: 'error', message: actionError(error) })
        })
      }, 180)
    })

    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [demoMode, loadRemoteSnapshot, snapshot])

  const clearNotice = useCallback(() => setNotice(null), [])

  const signIn = useCallback(
    async (mode: 'login' | 'register', input: AuthInput) => {
      setBusyAction('auth')
      setNotice(null)
      try {
        if (!isSupabaseConfigured) {
          setDemoMode(true)
          setSnapshot(createDemoSnapshot(input.nickname || '민준'))
          setNotice({
            type: 'info',
            message:
              'Supabase가 아직 연결되지 않아 데모 데이터로 시작했습니다.',
          })
          return
        }

        await authenticateWithPhone(mode, input)
        await loadRemoteSnapshot()
        setDemoMode(false)
        setNotice({
          type: 'success',
          message: mode === 'login' ? '로그인했습니다.' : '가입이 완료되었습니다.',
        })
      } catch (error) {
        setNotice({ type: 'error', message: actionError(error) })
        throw error
      } finally {
        setBusyAction(null)
      }
    },
    [loadRemoteSnapshot],
  )

  const enterDemo = useCallback((nickname = '민준') => {
    setDemoMode(true)
    setSnapshot(createDemoSnapshot(nickname.trim() || '민준'))
    setNotice({
      type: 'info',
      message: '데모 모드입니다. 새로고침하면 예시 데이터가 초기화됩니다.',
    })
  }, [])

  const logout = useCallback(async () => {
    setBusyAction('logout')
    try {
      if (!demoMode && supabase) {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      }
      setSnapshot(null)
      setDemoMode(false)
    } catch (error) {
      setNotice({ type: 'error', message: actionError(error) })
    } finally {
      setBusyAction(null)
    }
  }, [demoMode])

  const refresh = useCallback(async () => {
    if (demoMode || !snapshot) return
    setBusyAction('refresh')
    try {
      await loadRemoteSnapshot()
    } catch (error) {
      setNotice({ type: 'error', message: actionError(error) })
    } finally {
      setBusyAction(null)
    }
  }, [demoMode, loadRemoteSnapshot, snapshot])

  const runAction = useCallback(
    async (
      action: string,
      successMessage: string,
      remoteOperation: () => Promise<void>,
      demoOperation: (current: AppSnapshot) => AppSnapshot,
    ) => {
      if (!snapshot) return

      setBusyAction(action)
      setNotice(null)
      try {
        if (demoMode) {
          setSnapshot(demoOperation(snapshot))
        } else {
          await remoteOperation()
          await loadRemoteSnapshot()
        }
        setNotice({ type: 'success', message: successMessage })
      } catch (error) {
        setNotice({ type: 'error', message: actionError(error) })
      } finally {
        setBusyAction(null)
      }
    },
    [demoMode, loadRemoteSnapshot, snapshot],
  )

  const joinLesson = useCallback(
    () =>
      runAction(
        'lesson-join',
        '레슨 대기열에 참석했습니다.',
        lessonApi.join,
        (current) => {
          if (current.lesson.myBooking) {
            throw new Error('이미 오늘 레슨에 참석 중입니다.')
          }
          const booking = {
            id: crypto.randomUUID(),
            memberId: current.member.id,
            nickname: current.member.nickname,
            position: current.lesson.queue.length + 1,
            joinedAt: new Date().toISOString(),
            estimatedStartAt: new Date(
              Date.now() + Math.max(1, current.lesson.queue.length) * 15 * MINUTE,
            ).toISOString(),
            status: 'waiting' as const,
            isMine: true,
          }
          const todayKey = toSeoulDateKey()
          return refreshLessonQueue({
            ...current,
            lesson: {
              ...current.lesson,
              queue: [...current.lesson.queue, booking],
              myBooking: booking,
              monthlyCount: current.lesson.monthlyCount + 1,
              monthlyDates: current.lesson.monthlyDates.includes(todayKey)
                ? current.lesson.monthlyDates
                : [...current.lesson.monthlyDates, todayKey].sort(),
            },
            records: {
              ...current.records,
              lessonsThisMonth: current.records.lessonsThisMonth + 1,
            },
          })
        },
      ),
    [runAction],
  )

  const delayLesson = useCallback(
    () =>
      runAction(
        'lesson-delay',
        '내 순서를 맨 뒤로 옮겼습니다.',
        lessonApi.delay,
        (current) => {
          const mine = current.lesson.myBooking
          if (!mine) throw new Error('활성 레슨 참석이 없습니다.')
          const others = current.lesson.queue.filter(
            (booking) => booking.memberId !== current.member.id,
          )
          return refreshLessonQueue({
            ...current,
            lesson: {
              ...current.lesson,
              queue: [
                ...others,
                { ...mine, joinedAt: new Date().toISOString() },
              ],
            },
          })
        },
      ),
    [runAction],
  )

  const cancelLesson = useCallback(
    () =>
      runAction(
        'lesson-cancel',
        '오늘 레슨 참석을 취소했습니다.',
        lessonApi.cancel,
        (current) => {
          if (!current.lesson.myBooking) {
            throw new Error('취소할 레슨 참석이 없습니다.')
          }
          const todayKey = toSeoulDateKey()
          return refreshLessonQueue({
            ...current,
            lesson: {
              ...current.lesson,
              queue: current.lesson.queue.filter(
                (booking) => booking.memberId !== current.member.id,
              ),
              myBooking: null,
              monthlyCount: Math.max(0, current.lesson.monthlyCount - 1),
              monthlyDates: current.lesson.monthlyDates.filter(
                (dateKey) => dateKey !== todayKey,
              ),
            },
            records: {
              ...current.records,
              lessonsThisMonth: Math.max(
                0,
                current.records.lessonsThisMonth - 1,
              ),
            },
          })
        },
      ),
    [runAction],
  )

  const setGameAttendance = useCallback(
    (active: boolean) =>
      runAction(
        'game-attendance',
        active ? '게임 참석을 시작했습니다.' : '게임 참석을 종료했습니다.',
        () => gameApi.setAttendance(active),
        (current) => {
          const occupied = current.game.slots.some(
            (slot) =>
              (slot.status === 'open' || slot.status === 'playing') &&
              slot.players.some(
                (player) => player.memberId === current.member.id,
              ),
          )
          if (!active && occupied) {
            throw new Error('참여 중인 슬롯을 먼저 종료하거나 나가 주세요.')
          }

          const existing = current.game.attendees.find(
            (attendee) => attendee.memberId === current.member.id,
          )
          const attendees = existing
            ? current.game.attendees.map((attendee) =>
                attendee.memberId === current.member.id
                  ? {
                      ...attendee,
                      active,
                      lastJoinedCycle: active
                        ? Math.min(
                            attendee.lastJoinedCycle,
                            current.game.currentCycle - 1,
                          )
                        : attendee.lastJoinedCycle,
                    }
                  : attendee,
              )
            : [
                ...current.game.attendees,
                {
                  id: crypto.randomUUID(),
                  memberId: current.member.id,
                  nickname: current.member.nickname,
                  avatarUrl: current.member.avatarUrl,
                  gender: current.member.gender,
                  experienceMonths: current.member.experienceMonths,
                  lessonCount:
                    current.member.priorLessonCount +
                    current.lesson.monthlyCount,
                  gamesPlayed: 0,
                  lastJoinedCycle: current.game.currentCycle - 1,
                  lastGameAt: null,
                  active,
                  canJoin: active,
                },
              ]

          const game = advanceCycleIfComplete({
            ...current.game,
            attendees,
          })
          return withGameEligibility(current, game)
        },
      ),
    [runAction],
  )

  const createGameSlot = useCallback(
    (courtName: string, gameType: GameType = 'doubles') =>
      runAction(
        'game-create-slot',
        `${courtName}에 ${gameType === 'singles' ? '단식' : '복식'} 게임을 열었습니다.`,
        () => gameApi.createSlot(courtName, gameType),
        (current) => {
          const courtBusy = current.game.slots.some(
            (slot) =>
              slot.courtName === courtName &&
              (slot.status === 'open' || slot.status === 'playing'),
          )
          if (courtBusy) {
            throw new Error('해당 코트에 이미 진행 중이거나 모집 중인 게임이 있습니다.')
          }
          return withGameEligibility(current, {
            ...current.game,
            slots: [
              {
                id: crypto.randomUUID(),
                courtName,
                gameType,
                status: 'open',
                source: 'manual',
                createdAt: new Date().toISOString(),
                startedAt: null,
                players: [],
                result: null,
              },
              ...current.game.slots,
            ],
          })
        },
      ),
    [runAction],
  )

  const joinGameSlot = useCallback(
    (slotId: string) =>
      runAction(
        'game-join-slot',
        '게임 슬롯에 참여했습니다.',
        () => gameApi.joinSlot(slotId),
        (current) => {
          const slot = current.game.slots.find((item) => item.id === slotId)
          const attendance = current.game.attendees.find(
            (item) => item.memberId === current.member.id,
          )
          if (!slot || slot.status !== 'open') {
            throw new Error('참여할 수 없는 슬롯입니다.')
          }
          const capacity = gameSlotCapacity(slot.gameType ?? 'doubles')
          if (slot.players.length >= capacity) {
            throw new Error('게임 인원이 이미 가득 찼습니다.')
          }
          if (!attendance?.active) {
            throw new Error('먼저 오늘 게임 참석을 눌러 주세요.')
          }
          const occupied = current.game.slots.some(
            (item) =>
              (item.status === 'open' || item.status === 'playing') &&
              item.players.some(
                (player) => player.memberId === current.member.id,
              ),
          )
          if (occupied) {
            throw new Error('이미 다른 열린 게임에 참여 중입니다.')
          }

          const teamACount = slot.players.filter(
            (player) => player.team === 'A',
          ).length
          const player = {
            id: crypto.randomUUID(),
            memberId: current.member.id,
            nickname: current.member.nickname,
            isGuest: false,
            team:
              teamACount < capacity / 2 ? ('A' as const) : ('B' as const),
            joinedCycle: current.game.currentCycle,
            skillScore: calculateSkillScore(
              attendance.experienceMonths,
              attendance.lessonCount,
            ),
          }
          const slots = current.game.slots.map((item) =>
            item.id === slotId
              ? { ...item, players: [...item.players, player] }
              : item,
          )
          // 순환은 게임을 완료해야 반영되므로 참여 시점에는 바뀌지 않는다.
          return withGameEligibility(current, { ...current.game, slots })
        },
      ),
    [runAction],
  )

  const leaveGameSlot = useCallback(
    (slotId: string) =>
      runAction(
        'game-leave-slot',
        '열린 게임 슬롯에서 나왔습니다.',
        () => gameApi.leaveSlot(slotId),
        (current) => {
          const slot = current.game.slots.find((item) => item.id === slotId)
          if (!slot || slot.status !== 'open') {
            throw new Error('진행 중인 게임에서는 나갈 수 없습니다.')
          }
          const mine = slot.players.find(
            (player) => player.memberId === current.member.id,
          )
          if (!mine) throw new Error('참여 중인 슬롯이 아닙니다.')

          const slots = current.game.slots.map((item) =>
            item.id === slotId
              ? {
                  ...item,
                  players: item.players.filter(
                    (player) => player.memberId !== current.member.id,
                  ),
                }
              : item,
          )
          // 완료 전에는 순환 상태가 바뀐 적이 없으므로 되돌릴 것도 없다.
          return withGameEligibility(current, { ...current.game, slots })
        },
      ),
    [runAction],
  )

  const addGuestPlayer = useCallback(
    (slotId: string, guestName: string) =>
      runAction(
        'game-add-guest',
        `게스트 ${guestName.trim()}님을 추가했습니다.`,
        () => gameApi.addGuest(slotId, guestName.trim()),
        (current) => {
          const slot = current.game.slots.find((item) => item.id === slotId)
          if (!slot || slot.status !== 'open') {
            throw new Error('모집 중인 게임에만 게스트를 추가할 수 있습니다.')
          }
          const name = guestName.trim()
          if (name.length < 1 || name.length > 20) {
            throw new Error('게스트 이름은 1자 이상 20자 이하로 입력해 주세요.')
          }
          const capacity = gameSlotCapacity(slot.gameType ?? 'doubles')
          if (slot.players.length >= capacity) {
            throw new Error('게임 인원이 이미 가득 찼습니다.')
          }
          const teamACount = slot.players.filter(
            (player) => player.team === 'A',
          ).length
          const guest: GamePlayer = {
            id: crypto.randomUUID(),
            memberId: null,
            nickname: name,
            isGuest: true,
            team: teamACount < capacity / 2 ? 'A' : 'B',
            joinedCycle: current.game.currentCycle,
            skillScore: 0,
          }
          return withGameEligibility(current, {
            ...current.game,
            slots: current.game.slots.map((item) =>
              item.id === slotId
                ? { ...item, players: [...item.players, guest] }
                : item,
            ),
          })
        },
      ),
    [runAction],
  )

  const removeGuestPlayer = useCallback(
    (slotId: string, playerId: string) =>
      runAction(
        'game-remove-guest',
        '게스트를 제외했습니다.',
        () => gameApi.removeGuest(slotId, playerId),
        (current) => {
          const slot = current.game.slots.find((item) => item.id === slotId)
          if (!slot || slot.status !== 'open') {
            throw new Error('모집 중인 게임에서만 게스트를 제외할 수 있습니다.')
          }
          return withGameEligibility(current, {
            ...current.game,
            slots: current.game.slots.map((item) =>
              item.id === slotId
                ? {
                    ...item,
                    players: item.players.filter(
                      (player) =>
                        player.id !== playerId || player.memberId !== null,
                    ),
                  }
                : item,
            ),
          })
        },
      ),
    [runAction],
  )

  const startGameSlot = useCallback(
    (slotId: string) =>
      runAction(
        'game-start-slot',
        '게임을 시작했습니다.',
        () => gameApi.startSlot(slotId),
        (current) => {
          const slot = current.game.slots.find((item) => item.id === slotId)
          const capacity = slot
            ? gameSlotCapacity(slot.gameType ?? 'doubles')
            : 4
          if (!slot || slot.players.length !== capacity) {
            throw new Error(
              '팀 구성이 완성되어야 게임을 시작할 수 있습니다. (단식 1:1, 복식 2:2)',
            )
          }
          return withGameEligibility(current, {
            ...current.game,
            slots: current.game.slots.map((item) =>
              item.id === slotId
                ? {
                    ...item,
                    status: 'playing',
                    startedAt: new Date().toISOString(),
                  }
                : item,
            ),
          })
        },
      ),
    [runAction],
  )

  const completeGameSlot = useCallback(
    (slotId: string, teamAScore: number, teamBScore: number) =>
      runAction(
        'game-complete-slot',
        '점수와 전적을 저장했습니다.',
        () => gameApi.completeSlot(slotId, teamAScore, teamBScore),
        (current) => {
          if (teamAScore === teamBScore) {
            throw new Error('동점이 아닌 최종 점수를 입력해 주세요.')
          }
          const slot = current.game.slots.find((item) => item.id === slotId)
          if (
            !slot ||
            (slot.status !== 'playing' && slot.status !== 'completed')
          ) {
            throw new Error('점수를 입력하거나 수정할 수 있는 게임이 아닙니다.')
          }

          const isFirstCompletion = slot.status === 'playing'
          const winnerTeam = teamAScore > teamBScore ? ('A' as const) : ('B' as const)
          const now = new Date().toISOString()
          const playerIds = new Set(slot.players.map((player) => player.memberId))
          // 게임을 끝까지 마친 시점에만 순환 credit 을 준다.
          const attendees = current.game.attendees.map((attendee) =>
            isFirstCompletion && playerIds.has(attendee.memberId)
              ? {
                  ...attendee,
                  gamesPlayed: attendee.gamesPlayed + 1,
                  lastGameAt: now,
                  lastJoinedCycle: Math.max(
                    attendee.lastJoinedCycle,
                    current.game.currentCycle,
                  ),
                }
              : attendee,
          )
          const mine = slot.players.find(
            (player) => player.memberId === current.member.id,
          )
          const teammate = mine
            ? slot.players.find(
                (player) =>
                  player.team === mine.team &&
                  player.memberId !== current.member.id,
              )
            : undefined
          const didWin = mine?.team === winnerTeam
          const previouslyWon = mine?.team === slot.result?.winnerTeam
          const nextSummary = !mine
            ? current.records
            : isFirstCompletion
              ? {
                  ...current.records,
                  games: current.records.games + 1,
                  wins: current.records.wins + (didWin ? 1 : 0),
                  losses: current.records.losses + (didWin ? 0 : 1),
                }
              : previouslyWon === didWin
                ? current.records
                : {
                    ...current.records,
                    wins: current.records.wins + (didWin ? 1 : -1),
                    losses: current.records.losses + (didWin ? -1 : 1),
                  }
          const nextRecords = mine
            ? updateDemoPartnerRecord(
                nextSummary,
                teammate,
                isFirstCompletion,
                Boolean(didWin),
                Boolean(previouslyWon),
                now,
              )
            : nextSummary

          const nextGame = {
            ...current.game,
            attendees,
            slots: current.game.slots.map((item) =>
              item.id === slotId
                ? {
                    ...item,
                    status: 'completed' as const,
                    result: { teamAScore, teamBScore, winnerTeam },
                  }
                : item,
            ),
          }

          return withGameEligibility(
            {
              ...current,
              records: nextRecords,
            },
            isFirstCompletion ? advanceCycleIfComplete(nextGame) : nextGame,
          )
        },
      ),
    [runAction],
  )

  const confirmAutoArrangement = useCallback(
    (arrangement: AutoArrangement) =>
      runAction(
        'game-auto-confirm',
        '자동 배치 게임을 만들었습니다.',
        () => gameApi.confirmAuto(arrangement),
        (current) => {
          if (arrangement.candidates.length !== 4) {
            throw new Error('자동 배치에는 4명이 필요합니다.')
          }
          const selectedIds = new Set(
            arrangement.candidates.map((candidate) => candidate.memberId),
          )
          const invalid = current.game.attendees.some(
            (attendee) =>
              selectedIds.has(attendee.memberId) && !attendee.canJoin,
          )
          if (invalid) {
            throw new Error('참여 상태가 변경되었습니다. 다시 배치해 주세요.')
          }

          const slot = {
            id: crypto.randomUUID(),
            courtName: arrangement.courtName,
            status: 'open' as const,
            source: 'auto' as const,
            createdAt: new Date().toISOString(),
            startedAt: null,
            result: null,
            players: arrangement.candidates.map((candidate) => ({
              id: crypto.randomUUID(),
              memberId: candidate.memberId,
              nickname: candidate.nickname,
              team: candidate.team,
              joinedCycle: current.game.currentCycle,
              skillScore: candidate.skillScore,
            })),
          }
          // 순환은 게임 완료 시점에만 반영된다.
          return withGameEligibility(current, {
            ...current.game,
            slots: [slot, ...current.game.slots],
          })
        },
      ),
    [runAction],
  )

  const cancelGameSlot = useCallback(
    (slotId: string) =>
      runAction(
        'game-cancel-slot',
        '게임을 삭제했습니다.',
        () => gameApi.cancelSlot(slotId),
        (current) => {
          const slot = current.game.slots.find((item) => item.id === slotId)
          if (
            !slot ||
            (slot.status !== 'open' && slot.status !== 'playing')
          ) {
            throw new Error('이미 종료되었거나 취소된 게임입니다.')
          }
          // 완료 전 취소는 순환에 반영되지 않는다.
          return withGameEligibility(current, {
            ...current.game,
            slots: current.game.slots.filter((item) => item.id !== slotId),
          })
        },
      ),
    [runAction],
  )

  const createPost = useCallback(
    (
      category: PostCategory,
      title: string,
      content: string,
      details?: MatchingPostInput,
    ) =>
      runAction(
        'community-create-post',
        category === 'notice' ? '공지를 등록했습니다.' : '글을 등록했습니다.',
        () => communityApi.createPost(category, title, content, details),
        (current) => {
          if (category === 'notice' && current.member.role !== 'owner') {
            throw new Error('공지사항은 관리자만 작성할 수 있습니다.')
          }
          if (category === 'matching' && !details) {
            throw new Error('날짜, 시간, 장소, 모집 인원을 입력해 주세요.')
          }
          const post: Post = {
            id: crypto.randomUUID(),
            category,
            title: title.trim(),
            content: content.trim(),
            authorId: current.member.id,
            authorNickname: current.member.nickname,
            authorAvatarUrl: current.member.avatarUrl,
            createdAt: new Date().toISOString(),
            eventDate: details?.eventDate ?? null,
            eventTime: details?.eventTime ?? null,
            location: details?.location ?? null,
            capacity: details?.capacity ?? null,
            participants: [],
            myJoined: false,
          }
          return {
            ...current,
            community: {
              ...current.community,
              notices:
                category === 'notice'
                  ? [post, ...current.community.notices]
                  : current.community.notices,
              matching:
                category === 'matching'
                  ? [post, ...current.community.matching]
                  : current.community.matching,
            },
          }
        },
      ),
    [runAction],
  )

  const deletePost = useCallback(
    (postId: string) =>
      runAction(
        'community-delete-post',
        '글을 삭제했습니다.',
        () => communityApi.deletePost(postId),
        (current) => ({
          ...current,
          community: {
            ...current.community,
            notices: current.community.notices.filter(
              (post) => post.id !== postId,
            ),
            matching: current.community.matching.filter(
              (post) => post.id !== postId,
            ),
          },
        }),
      ),
    [runAction],
  )

  const joinPost = useCallback(
    (postId: string) =>
      runAction(
        'community-join-post',
        '매칭에 참석했습니다.',
        () => communityApi.joinPost(postId),
        (current) => {
          const target = current.community.matching.find(
            (post) => post.id === postId,
          )
          if (!target) throw new Error('참석할 글을 찾을 수 없습니다.')
          if (target.myJoined) throw new Error('이미 참석한 글입니다.')
          if (
            target.capacity !== null &&
            target.participants.length >= target.capacity
          ) {
            throw new Error('모집 인원이 가득 찼습니다.')
          }
          return {
            ...current,
            community: {
              ...current.community,
              matching: current.community.matching.map((post) =>
                post.id === postId
                  ? {
                      ...post,
                      myJoined: true,
                      participants: [
                        ...post.participants,
                        {
                          memberId: current.member.id,
                          nickname: current.member.nickname,
                          avatarUrl: current.member.avatarUrl,
                        },
                      ],
                    }
                  : post,
              ),
            },
          }
        },
      ),
    [runAction],
  )

  const leavePost = useCallback(
    (postId: string) =>
      runAction(
        'community-leave-post',
        '매칭 참석을 취소했습니다.',
        () => communityApi.leavePost(postId),
        (current) => ({
          ...current,
          community: {
            ...current.community,
            matching: current.community.matching.map((post) =>
              post.id === postId
                ? {
                    ...post,
                    myJoined: false,
                    participants: post.participants.filter(
                      (participant) =>
                        participant.memberId !== current.member.id,
                    ),
                  }
                : post,
            ),
          },
        }),
      ),
    [runAction],
  )

  const uploadAvatar = useCallback(
    async (file: File) => {
      if (!snapshot) return
      if (!file.type.startsWith('image/')) {
        setNotice({ type: 'error', message: '이미지 파일만 올릴 수 있습니다.' })
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        setNotice({
          type: 'error',
          message: '10MB 이하의 이미지를 선택해 주세요.',
        })
        return
      }

      setBusyAction('avatar-upload')
      setNotice(null)
      try {
        if (demoMode) {
          const localUrl = URL.createObjectURL(file)
          setSnapshot({
            ...snapshot,
            member: { ...snapshot.member, avatarUrl: localUrl },
            community: {
              ...snapshot.community,
              members: snapshot.community.members.map((member) =>
                member.memberId === snapshot.member.id
                  ? { ...member, avatarUrl: localUrl }
                  : member,
              ),
            },
          })
        } else {
          await uploadAvatarPhoto(file)
          await loadRemoteSnapshot()
        }
        setNotice({ type: 'success', message: '프로필 사진을 변경했습니다.' })
      } catch (error) {
        setNotice({ type: 'error', message: actionError(error) })
      } finally {
        setBusyAction(null)
      }
    },
    [demoMode, loadRemoteSnapshot, snapshot],
  )

  const saveProfile = useCallback(
    (input: ProfileInput) =>
      runAction(
        'profile-save',
        '내 정보를 저장했습니다.',
        () => updateProfile(input),
        (current) => {
          const member = { ...current.member, ...input }
          const lessonQueue = current.lesson.queue.map((booking) =>
            booking.memberId === current.member.id
              ? { ...booking, nickname: input.nickname }
              : booking,
          )
          const attendees = current.game.attendees.map((attendee) =>
            attendee.memberId === current.member.id
              ? {
                  ...attendee,
                  nickname: input.nickname,
                  gender: input.gender,
                  experienceMonths: input.experienceMonths,
                  lessonCount:
                    input.priorLessonCount + current.lesson.monthlyCount,
                }
              : attendee,
          )
          const communityMembers = current.community.members.map(
            (communityMember) =>
              communityMember.memberId === current.member.id
                ? {
                    ...communityMember,
                    nickname: input.nickname,
                    gender: input.gender,
                    experienceMonths: input.experienceMonths,
                    lessonCount:
                      input.priorLessonCount + current.lesson.monthlyCount,
                  }
                : communityMember,
          )
          return withGameEligibility({
            ...current,
            member,
            lesson: {
              ...current.lesson,
              queue: lessonQueue,
              myBooking:
                lessonQueue.find(
                  (booking) => booking.memberId === current.member.id,
                ) ?? null,
            },
            game: { ...current.game, attendees },
            community: { ...current.community, members: communityMembers },
          })
        },
      ),
    [runAction],
  )

  const enableNotifications = useCallback(
    () =>
      runAction(
        'enable-notifications',
        demoMode
          ? '데모에서는 알림 화면만 확인할 수 있습니다.'
          : '레슨 알림을 켰습니다.',
        demoMode ? async () => undefined : enablePushNotifications,
        (current) => current,
      ),
    [demoMode, runAction],
  )

  const value = useMemo(
    () => ({
      ready,
      authenticated: Boolean(snapshot),
      demoMode,
      snapshot,
      busyAction,
      notice,
      clearNotice,
      signIn,
      enterDemo,
      logout,
      refresh,
      joinLesson,
      delayLesson,
      cancelLesson,
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
      createPost,
      deletePost,
      joinPost,
      leavePost,
      uploadAvatar,
      saveProfile,
      enableNotifications,
    }),
    [
      ready,
      snapshot,
      demoMode,
      busyAction,
      notice,
      clearNotice,
      signIn,
      enterDemo,
      logout,
      refresh,
      joinLesson,
      delayLesson,
      cancelLesson,
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
      createPost,
      deletePost,
      joinPost,
      leavePost,
      uploadAvatar,
      saveProfile,
      enableNotifications,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
