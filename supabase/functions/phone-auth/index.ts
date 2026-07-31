import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

type AuthAction = 'login' | 'register' | 'reset-password'

interface AuthBody {
  action?: AuthAction
  phone?: string
  password?: string
  nickname?: string
  memberId?: string
  newPassword?: string
}

const ETRI_CLUB_CODE = 'ETRI'
const ETRI_CLUB_NAME = 'ETRI 콕콕'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const authPepper = Deno.env.get('AUTH_PEPPER')

if (!supabaseUrl || !serviceRoleKey || !anonKey || !authPepper) {
  throw new Error('phone-auth 필수 환경 변수가 설정되지 않았습니다.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (/^010\d{8}$/.test(digits)) {
    return `+82${digits.slice(1)}`
  }
  if (/^8210\d{8}$/.test(digits)) {
    return `+${digits}`
  }
  throw new Error('휴대전화 번호를 010-1234-5678 형식으로 입력해 주세요.')
}

function validatePassword(value: string, fieldName = '비밀번호'): string {
  if (value.length < 8 || value.length > 64) {
    throw new Error(`${fieldName}는 8자 이상 64자 이하로 입력해 주세요.`)
  }
  return value
}

function validateNickname(value: string): string {
  const nickname = value.trim().replace(/\s+/g, ' ')
  if (nickname.length < 2 || nickname.length > 20) {
    throw new Error('이름 또는 닉네임은 2자 이상 20자 이하로 입력해 주세요.')
  }
  return nickname
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function buildAuthEmail(normalizedPhone: string): Promise<string> {
  const phoneHash = await sha256(`${authPepper}:${normalizedPhone}`)
  return `phone-${phoneHash}@members.etri.invalid`
}

async function buildInternalPassword(
  authEmail: string,
  password: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authPepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${authEmail}:${password}`),
  )
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `Et!9${encoded}`
}

async function checkRateLimit(identifierHash: string): Promise<void> {
  const { data } = await admin
    .from('login_attempts')
    .select('lock_until')
    .eq('identifier_hash', identifierHash)
    .maybeSingle()

  if (data?.lock_until && new Date(data.lock_until).getTime() > Date.now()) {
    throw new Error('로그인 시도가 많습니다. 10분 후 다시 시도해 주세요.')
  }
}

async function recordFailure(identifierHash: string): Promise<void> {
  const { data } = await admin
    .from('login_attempts')
    .select('failed_count, last_attempt_at')
    .eq('identifier_hash', identifierHash)
    .maybeSingle()

  const isExpired =
    !data?.last_attempt_at ||
    Date.now() - new Date(data.last_attempt_at).getTime() > 10 * 60_000
  const failedCount = (isExpired ? 0 : (data?.failed_count ?? 0)) + 1
  const lockUntil =
    failedCount >= 5 ? new Date(Date.now() + 10 * 60_000).toISOString() : null

  await admin.from('login_attempts').upsert({
    identifier_hash: identifierHash,
    failed_count: failedCount,
    lock_until: lockUntil,
    last_attempt_at: new Date().toISOString(),
  })
}

async function clearFailures(identifierHash: string): Promise<void> {
  await admin
    .from('login_attempts')
    .delete()
    .eq('identifier_hash', identifierHash)
}

async function signIn(normalizedPhone: string, password: string) {
  const authEmail = await buildAuthEmail(normalizedPhone)
  const internalPassword = await buildInternalPassword(authEmail, password)
  const { data, error } = await authClient.auth.signInWithPassword({
    email: authEmail,
    password: internalPassword,
  })
  if (error || !data.session) {
    throw new Error('전화번호 또는 비밀번호를 확인해 주세요.')
  }
  return data.session
}

async function login(phone: string, password: string, clientIp: string) {
  const normalizedPhone = normalizePhone(phone)
  validatePassword(password)
  const identifierHash = await sha256(
    `${authPepper}:${normalizedPhone}:${clientIp}`,
  )
  await checkRateLimit(identifierHash)

  try {
    const session = await signIn(normalizedPhone, password)
    await clearFailures(identifierHash)
    return session
  } catch (error) {
    await recordFailure(identifierHash)
    throw error
  }
}

async function findOrCreateEtriClub() {
  const { data: existing } = await admin
    .from('clubs')
    .select('id, name')
    .eq('code_normalized', ETRI_CLUB_CODE)
    .maybeSingle()
  if (existing) return { club: existing, created: false }

  const joinCodeHash = await sha256(`${authPepper}:${ETRI_CLUB_CODE}`)
  const { data: created, error } = await admin
    .from('clubs')
    .insert({
      name: ETRI_CLUB_NAME,
      code_normalized: ETRI_CLUB_CODE,
      join_code_hash: joinCodeHash,
    })
    .select('id, name')
    .single()
  if (!error && created) return { club: created, created: true }

  const { data: racedClub } = await admin
    .from('clubs')
    .select('id, name')
    .eq('code_normalized', ETRI_CLUB_CODE)
    .single()
  if (!racedClub) throw new Error('ETRI 동호회를 준비하지 못했습니다.')
  return { club: racedClub, created: false }
}

async function register(body: AuthBody) {
  const normalizedPhone = normalizePhone(body.phone ?? '')
  const password = validatePassword(body.password ?? '')
  const nickname = validateNickname(body.nickname ?? '')
  const { club, created: clubCreated } = await findOrCreateEtriClub()
  const authEmail = await buildAuthEmail(normalizedPhone)
  const internalPassword = await buildInternalPassword(authEmail, password)

  const { count } = await admin
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', club.id)
  const role = (count ?? 0) === 0 ? 'owner' : 'member'

  const { data: createdUser, error: createUserError } =
    await admin.auth.admin.createUser({
      email: authEmail,
      password: internalPassword,
      email_confirm: true,
      user_metadata: {
        club_id: club.id,
        nickname,
        login_type: 'phone_hash',
      },
    })

  if (createUserError || !createdUser.user) {
    if (clubCreated) await admin.from('clubs').delete().eq('id', club.id)
    throw new Error('이미 가입된 전화번호이거나 회원 계정을 만들 수 없습니다.')
  }

  const userId = createdUser.user.id
  try {
    const { error: memberError } = await admin.from('members').insert({
      id: userId,
      club_id: club.id,
      nickname,
      nickname_normalized: nickname.toLocaleLowerCase('ko-KR'),
      role,
    })
    if (memberError) throw memberError

    if (role === 'owner') {
      await admin
        .from('clubs')
        .update({ created_by: userId })
        .eq('id', club.id)
        .is('created_by', null)
    }

    return await signIn(normalizedPhone, password)
  } catch (error) {
    await admin.auth.admin.deleteUser(userId)
    if (clubCreated) await admin.from('clubs').delete().eq('id', club.id)
    console.error('회원 등록 롤백:', error)
    throw new Error('회원 등록을 완료하지 못했습니다.')
  }
}

async function resetPassword(request: Request, body: AuthBody) {
  if (!body.memberId) throw new Error('비밀번호를 변경할 회원이 필요합니다.')
  const newPassword = validatePassword(body.newPassword ?? '', '새 비밀번호')
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('관리자 로그인이 필요합니다.')

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) throw new Error('관리자 로그인이 필요합니다.')

  const [{ data: actor }, { data: targetMember }, { data: targetUser }] =
    await Promise.all([
      admin
        .from('members')
        .select('club_id, role, is_active')
        .eq('id', userData.user.id)
        .single(),
      admin
        .from('members')
        .select('club_id')
        .eq('id', body.memberId)
        .single(),
      admin.auth.admin.getUserById(body.memberId),
    ])

  if (
    !actor?.is_active ||
    actor.role !== 'owner' ||
    !targetMember ||
    targetMember.club_id !== actor.club_id ||
    !targetUser.user?.email
  ) {
    throw new Error('비밀번호를 재설정할 권한이 없습니다.')
  }

  const internalPassword = await buildInternalPassword(
    targetUser.user.email,
    newPassword,
  )
  const { error } = await admin.auth.admin.updateUserById(body.memberId, {
    password: internalPassword,
  })
  if (error) throw new Error('비밀번호를 재설정하지 못했습니다.')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405)
  }

  try {
    const body = (await request.json()) as AuthBody
    if (body.action === 'reset-password') {
      await resetPassword(request, body)
      return jsonResponse({ success: true })
    }

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('cf-connecting-ip') ??
      'unknown'
    const session =
      body.action === 'register'
        ? await register(body)
        : await login(body.phone ?? '', body.password ?? '', clientIp)

    return jsonResponse({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '인증 요청을 처리하지 못했습니다.'
    const status = message.includes('10분 후') ? 429 : 400
    return jsonResponse({ error: message }, status)
  }
})
