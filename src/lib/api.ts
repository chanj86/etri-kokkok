import type {
  AppSnapshot,
  AuthInput,
  AutoArrangement,
  MatchingPostInput,
  PartnerRecord,
  PostCategory,
  ProfileInput,
  Team,
} from '../types'
import { requireSupabase } from './supabase'

type AuthMode = 'login' | 'register'

interface PhoneAuthResponse {
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

export async function authenticateWithPhone(
  mode: AuthMode,
  input: AuthInput,
): Promise<void> {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<PhoneAuthResponse>(
    'phone-auth',
    {
      body: {
        action: mode,
        phone: input.phone.trim(),
        password: input.password,
        nickname: input.nickname?.trim(),
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
    // 데이터베이스 마이그레이션이 아직 적용되지 않은 순간에도 화면이 동작하도록 기본값을 채운다.
    lesson: {
      ...snapshot.lesson,
      monthlyDates: snapshot.lesson?.monthlyDates ?? [],
    },
    community: {
      members: snapshot.community?.members ?? [],
      notices: snapshot.community?.notices ?? [],
      matching: snapshot.community?.matching ?? [],
      teamRankings: snapshot.community?.teamRankings ?? [],
    },
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
  cancelSlot: (slotId: string) =>
    runAction('cancel_game_slot', { p_slot_id: slotId }),
}

export const communityApi = {
  createPost: (
    category: PostCategory,
    title: string,
    content: string,
    details?: MatchingPostInput,
  ) =>
    runAction('create_post', {
      p_category: category,
      p_title: title,
      p_content: content,
      ...(details
        ? {
            p_event_date: details.eventDate,
            p_event_time: details.eventTime,
            p_location: details.location,
            p_capacity: details.capacity,
          }
        : {}),
    }),
  deletePost: (postId: string) =>
    runAction('delete_post', { p_post_id: postId }),
  joinPost: (postId: string) => runAction('join_post', { p_post_id: postId }),
  leavePost: (postId: string) =>
    runAction('leave_post', { p_post_id: postId }),
}

export async function updateProfile(input: ProfileInput): Promise<void> {
  await runAction('update_my_profile', {
    p_nickname: input.nickname.trim(),
    p_gender: input.gender,
    p_experience_months: input.experienceMonths,
    p_prior_lesson_count: input.priorLessonCount,
  })
}

export async function resizeImageToJpeg(
  file: File,
  maxSize: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('이미지를 처리할 수 없습니다.')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.')),
      'image/jpeg',
      0.86,
    )
  })
}

export async function uploadAvatarPhoto(file: File): Promise<string> {
  const client = requireSupabase()
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser()
  if (userError || !user) throw new Error('로그인이 필요합니다.')

  const blob = await resizeImageToJpeg(file, 320)
  const path = `${user.id}/avatar.jpg`

  const { error: uploadError } = await client.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (uploadError) {
    throw new Error('사진 업로드에 실패했습니다. 다시 시도해 주세요.')
  }

  const { data } = client.storage.from('avatars').getPublicUrl(path)
  // 같은 경로에 덮어쓰므로 캐시를 피하기 위해 버전 값을 붙인다.
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`
  await runAction('update_my_avatar', { p_avatar_url: avatarUrl })
  return avatarUrl
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

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandaloneApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator &&
      (navigator as { standalone?: boolean }).standalone === true)
  )
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()

  if (!existing) {
    if (!import.meta.env.PROD) {
      throw new Error(
        '알림은 배포된 앱에서만 켤 수 있습니다. (개발 모드에서는 서비스 워커가 없습니다.)',
      )
    }
    await navigator.serviceWorker.register('/sw.js')
  }

  // 서비스 워커 활성화를 기다리되, 문제가 있으면 8초 후 명확한 오류를 준다.
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 8000)
    }),
  ])
  if (!ready) {
    throw new Error(
      '알림 준비에 실패했습니다. 앱을 완전히 닫았다가 다시 열어 주세요.',
    )
  }
  return ready
}

export async function enablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.')
  }

  if (!('PushManager' in window) || !('Notification' in window)) {
    if (isIosDevice() && !isStandaloneApp()) {
      throw new Error(
        'iPhone/iPad에서는 공유 → "홈 화면에 추가"로 설치한 앱에서만 알림을 켤 수 있습니다.',
      )
    }
    throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.')
  }

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  if (!publicKey || publicKey.includes('your-vapid')) {
    throw new Error('푸시 알림 서버 키가 설정되지 않았습니다.')
  }

  if (Notification.permission === 'denied') {
    throw new Error(
      '알림이 차단되어 있습니다. 브라우저(또는 기기) 설정에서 이 앱의 알림 차단을 해제한 뒤 다시 시도해 주세요.',
    )
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('알림 권한이 허용되지 않았습니다.')
  }

  const registration = await getPushRegistration()

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    } catch {
      throw new Error(
        '푸시 구독에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      )
    }
  }

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
    'posts',
    'post_participants',
    'members',
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
