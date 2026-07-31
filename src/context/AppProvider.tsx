import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  authenticateWithPin,
  enablePushNotifications,
  fetchSnapshot,
  gameApi,
  lessonApi,
  subscribeToClubChanges,
  updateProfile,
} from '../lib/api'
import { createDemoSnapshot } from '../lib/demoData'
import { calculateSkillScore } from '../lib/gameMatching'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type {
  AppSnapshot,
  AuthInput,
  AutoArrangement,
  GameSnapshot,
  ProfileInput,
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

function refreshLessonQueue(snapshot: AppSnapshot): AppSnapshot {
  const activeQueue = snapshot.lesson.queue.filter(
    (booking) => booking.status === 'waiting',
  )
  const firstTime = activeQueue[0]?.estimatedStartAt
    ? new Date(activeQueue[0].estimatedStartAt).getTime()
    : Date.now() + 10 * MINUTE

  const queue = activeQueue.map((booking, index) => ({
    ...booking,
    position: index + 1,
    estimatedStartAt: new Date(firstTime + index * 15 * MINUTE).toISOString(),
  }))
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

        await authenticateWithPin(mode, input)
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
          return refreshLessonQueue({
            ...current,
            lesson: {
              ...current.lesson,
              queue: [...current.lesson.queue, booking],
              myBooking: booking,
              monthlyCount: current.lesson.monthlyCount + 1,
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
          return refreshLessonQueue({
            ...current,
            lesson: {
              ...current.lesson,
              queue: current.lesson.queue.filter(
                (booking) => booking.memberId !== current.member.id,
              ),
              myBooking: null,
              monthlyCount: Math.max(0, current.lesson.monthlyCount - 1),
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
    (courtName: string) =>
      runAction(
        'game-create-slot',
        `${courtName} 게임 슬롯을 열었습니다.`,
        () => gameApi.createSlot(courtName),
        (current) =>
          withGameEligibility(current, {
            ...current.game,
            slots: [
              {
                id: crypto.randomUUID(),
                courtName,
                status: 'open',
                source: 'manual',
                createdAt: new Date().toISOString(),
                players: [],
                result: null,
              },
              ...current.game.slots,
            ],
          }),
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
          if (slot.players.length >= 4) throw new Error('슬롯이 가득 찼습니다.')
          if (!attendance?.active || !attendance.canJoin) {
            throw new Error('다른 회원의 순환이 끝날 때까지 기다려 주세요.')
          }

          const joinedCycle = current.game.currentCycle
          const player = {
            id: crypto.randomUUID(),
            memberId: current.member.id,
            nickname: current.member.nickname,
            team: slot.players.length < 2 ? ('A' as const) : ('B' as const),
            joinedCycle,
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
          const attendees = current.game.attendees.map((item) =>
            item.memberId === current.member.id
              ? { ...item, lastJoinedCycle: joinedCycle }
              : item,
          )
          const game = advanceCycleIfComplete({
            ...current.game,
            slots,
            attendees,
          })
          return withGameEligibility(current, game)
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
          const attendees = current.game.attendees.map((item) =>
            item.memberId === current.member.id
              ? {
                  ...item,
                  lastJoinedCycle: Math.min(
                    item.lastJoinedCycle,
                    current.game.currentCycle - 1,
                  ),
                }
              : item,
          )
          return withGameEligibility(current, {
            ...current.game,
            slots,
            attendees,
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
          if (!slot || slot.players.length !== 4) {
            throw new Error('4명이 모두 모여야 게임을 시작할 수 있습니다.')
          }
          return withGameEligibility(current, {
            ...current.game,
            slots: current.game.slots.map((item) =>
              item.id === slotId ? { ...item, status: 'playing' } : item,
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
          const attendees = current.game.attendees.map((attendee) =>
            isFirstCompletion && playerIds.has(attendee.memberId)
              ? {
                  ...attendee,
                  gamesPlayed: attendee.gamesPlayed + 1,
                  lastGameAt: now,
                }
              : attendee,
          )
          const mine = slot.players.find(
            (player) => player.memberId === current.member.id,
          )
          const didWin = mine?.team === winnerTeam
          const previouslyWon = mine?.team === slot.result?.winnerTeam
          const nextRecords = !mine
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

          return withGameEligibility(
            {
              ...current,
              records: nextRecords,
            },
            {
              ...current.game,
              attendees,
              slots: current.game.slots.map((item) =>
                item.id === slotId
                  ? {
                      ...item,
                      status: 'completed',
                      result: { teamAScore, teamBScore, winnerTeam },
                    }
                  : item,
              ),
            },
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

          const joinedCycle = current.game.currentCycle
          const slot = {
            id: crypto.randomUUID(),
            courtName: arrangement.courtName,
            status: 'open' as const,
            source: 'auto' as const,
            createdAt: new Date().toISOString(),
            result: null,
            players: arrangement.candidates.map((candidate) => ({
              id: crypto.randomUUID(),
              memberId: candidate.memberId,
              nickname: candidate.nickname,
              team: candidate.team,
              joinedCycle,
              skillScore: candidate.skillScore,
            })),
          }
          const attendees = current.game.attendees.map((attendee) =>
            selectedIds.has(attendee.memberId)
              ? { ...attendee, lastJoinedCycle: joinedCycle }
              : attendee,
          )
          const game = advanceCycleIfComplete({
            ...current.game,
            attendees,
            slots: [slot, ...current.game.slots],
          })
          return withGameEligibility(current, game)
        },
      ),
    [runAction],
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
      startGameSlot,
      completeGameSlot,
      confirmAutoArrangement,
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
      startGameSlot,
      completeGameSlot,
      confirmAutoArrangement,
      saveProfile,
      enableNotifications,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
