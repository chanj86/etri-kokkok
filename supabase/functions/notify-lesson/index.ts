import { createClient } from 'npm:@supabase/supabase-js'
import webpush from 'npm:web-push@3.6.7'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

interface DueNotification {
  notification_id: string
  endpoint: string
  p256dh: string
  auth_key: string
  title: string
  body: string
  target_url: string
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT')
const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET')
const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

if (
  !supabaseUrl ||
  !serviceRoleKey ||
  !vapidPublicKey ||
  !vapidPrivateKey ||
  !vapidSubject ||
  !cronSecret
) {
  throw new Error('notify-lesson 필수 환경 변수가 설정되지 않았습니다.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

async function markFinished(
  notificationId: string,
  success: boolean,
  errorMessage?: string,
) {
  await admin.rpc('finish_lesson_notification', {
    p_notification_id: notificationId,
    p_success: success,
    p_error_message: errorMessage ?? null,
  })
}

async function sendNotification(notification: DueNotification) {
  const targetUrl = `${appUrl}${notification.target_url}`
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    icon: `${appUrl}/badminton-icon.svg`,
    badge: `${appUrl}/badminton-icon.svg`,
    data: { url: targetUrl },
  })

  try {
    await webpush.sendNotification(
      {
        endpoint: notification.endpoint,
        keys: {
          p256dh: notification.p256dh,
          auth: notification.auth_key,
        },
      },
      payload,
      {
        TTL: 60 * 30,
        urgency: 'high',
      },
    )
    await markFinished(notification.notification_id, true)
    return true
  } catch (error) {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined
    const message =
      error instanceof Error ? error.message : 'Web Push 전송 오류'

    if (statusCode === 404 || statusCode === 410) {
      await admin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', notification.endpoint)
    }
    await markFinished(notification.notification_id, false, message)
    return false
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405)
  }
  if (request.headers.get('x-cron-secret') !== cronSecret) {
    return jsonResponse({ error: '예약 작업 인증에 실패했습니다.' }, 401)
  }

  const { data, error } = await admin.rpc('claim_due_lesson_notifications', {
    p_limit: 100,
  })
  if (error) {
    console.error('알림 조회 실패:', error)
    return jsonResponse({ error: '발송할 알림을 조회하지 못했습니다.' }, 500)
  }

  const notifications = (data ?? []) as DueNotification[]
  const results = await Promise.all(notifications.map(sendNotification))
  const sent = results.filter(Boolean).length

  return jsonResponse({
    success: true,
    claimed: notifications.length,
    sent,
    failed: notifications.length - sent,
  })
})
