import type {
  AppSnapshot,
  AuthInput,
  AutoArrangement,
  PartnerRecord,
  ProfileInput,
  Team,
} from '../types'
import { requireSupabase } from './supabase'

type AuthMode = 'login' | 'register'

interface PinAuthResponse {
  session?: {
    access_token: string
    refresh_token: string
  }
  error?: string
}

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  return new Error(fallback)
}

export async function authenticateWithPin(
  mode: AuthMode,
  input: AuthInput,
): Promise<void> {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<PinAuthResponse>(
    'pin-auth',
    {
      body: {
        action: mode,
        clubCode: input.clubCode.trim(),
        nickname: input.nickname.trim(),
        pin: input.pin,
      },
    },
  )

  if (error) throw asError(error, '인증 서버에 연결하지 못했습니다.')
  if (!data?.session) {
    throw new Error(data?.error ?? '로그인 정보를 확인해 주세요.')
  }

  const { error: sessionError } = await client.auth.setSession(data.session)
  if (sessionError) throw sessionError
}

export async function fetchSnapshot(): Promise<AppSnapshot> {
  const client = requireSupabase()
  const [snapshotResult, partnerResult] = await Promise.all([
    client.rpc('get_app_snapshot'),
    client.rpc('get_my_partner_stats'),
  ])

  if (snapshotResult.error) throw snapshotResult.error
  if (partnerResult.error) throw partnerResult.error
  if (!snapshotResult.data) {
    throw new Error('동호회 데이터를 불러오지 못했습니다.')
  }

  const snapshot = snapshotResult.data as AppSnapshot
  return {
    ...snapshot,
    records: {
      ...snapshot.records,
      partnerStats: (partnerResult.data ?? []) as PartnerRecord[],
    },
  }
}

async function runAction(
  functionName: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  const client = requireSupabase()
  const { error } = await client.rpc(functionName, params)
  if (error) throw error
}

export const lessonApi = {
  join: () => runAction('join_lesson'),
  delay: () => runAction('delay_lesson'),
  cancel: () => runAction('cancel_lesson'),
}

export const gameApi = {
  setAttendance: (active: boolean) =>
    runAction('set_game_attendance', { p_active: active }),
  createSlot: (courtName: string) =>
    runAction('create_game_slot', { p_court_name: courtName }),
  joinSlot: (slotId: string) =>
    runAction('join_game_slot', { p_slot_id: slotId }),
  leaveSlot: (slotId: string) =>
    runAction('leave_game_slot', { p_slot_id: slotId }),
  startSlot: (slotId: string) =>
    runAction('start_game_slot', { p_slot_id: slotId }),
  completeSlot: (
    slotId: string,
    teamAScore: number,
    teamBScore: number,
  ) =>
    runAction('complete_game_slot', {
      p_slot_id: slotId,
      p_team_a_score: teamAScore,
      p_team_b_score: teamBScore,
    }),
  confirmAuto: (arrangement: AutoArrangement) =>
    runAction('confirm_auto_arrangement', {
      p_court_name: arrangement.courtName,
      p_players: arrangement.candidates.map((candidate) => ({
        memberId: candidate.memberId,
        team: candidate.team,
      })),
    }),
  changeTeam: (slotId: string, memberId: string, team: Team) =>
    runAction('change_game_team', {
      p_slot_id: slotId,
      p_member_id: memberId,
      p_team: team,
    }),
}

export async function updateProfile(input: ProfileInput): Promise<void> {
  await runAction('update_my_profile', {
    p_nickname: input.nickname.trim(),
    p_gender: input.gender,
    p_experience_months: input.experienceMonths,
    p_prior_lesson_count: input.priorLessonCount,
  })
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index)
  }
  return output
}

export async function enablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.')
  }

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  if (!publicKey || publicKey.includes('your-vapid')) {
    throw new Error('푸시 알림 서버 키가 설정되지 않았습니다.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('알림 권한이 허용되지 않았습니다.')
  }

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))

  await runAction('save_push_subscription', {
    p_subscription: subscription.toJSON(),
  })
}

export function subscribeToClubChanges(onChange: () => void): () => void {
  const client = requireSupabase()
  const channel = client.channel('club-live-updates')

  const tables = [
    'lesson_bookings',
    'game_attendances',
    'game_slots',
    'game_slot_players',
    'game_results',
  ]

  tables.forEach((table) => {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      onChange,
    )
  })

  channel.subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
