import { createClient } from 'npm:@supabase/supabase-js'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

type AuthAction = 'login' | 'register' | 'reset-pin'

interface AuthBody {
  action?: AuthAction
  clubCode?: string
  nickname?: string
  pin?: string
  memberId?: string
  newPin?: string
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const pinPepper = Deno.env.get('PIN_PEPPER')

if (!supabaseUrl || !serviceRoleKey || !anonKey || !pinPepper) {
  throw new Error('pin-auth 필수 환경 변수가 설정되지 않았습니다.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function normalizeClubCode(value: string): string {
  return value.trim().toUpperCase()
}

function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function validateAuthInput(body: AuthBody) {
  const clubCode = normalizeClubCode(body.clubCode ?? '')
  const nickname = (body.nickname ?? '').trim().replace(/\s+/g, ' ')
  const pin = body.pin ?? ''

  if (!/^[A-Z0-9_-]{3,24}$/.test(clubCode)) {
    throw new Error('동호회 코드는 영문, 숫자, -, _ 조합 3~24자로 입력해 주세요.')
  }
  if (nickname.length < 2 || nickname.length > 20) {
    throw new Error('닉네임은 2자 이상 20자 이하로 입력해 주세요.')
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('PIN은 숫자 6자리로 입력해 주세요.')
  }

  return { clubCode, nickname, pin }
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

async function buildInternalPassword(
  authEmail: string,
  pin: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pinPepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${authEmail}:${pin}`),
  )
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `Kk!9${encoded}`
}

async function checkRateLimit(identifierHash: string): Promise<void> {
  const { data } = await admin
    .from('login_attempts')
    .select('failed_count, lock_until, last_attempt_at')
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

async function signIn(authEmail: string, pin: string) {
  const password = await buildInternalPassword(authEmail, pin)
  const { data, error } = await authClient.auth.signInWithPassword({
    email: authEmail,
    password,
  })
  if (error || !data.session) {
    throw new Error('동호회 코드, 닉네임 또는 PIN을 확인해 주세요.')
  }
  return data.session
}

async function login(
  input: ReturnType<typeof validateAuthInput>,
  clientIp: string,
) {
  const normalizedName = normalizeNickname(input.nickname)
  const identifierHash = await sha256(
    `${input.clubCode}:${normalizedName}:${clientIp}`,
  )
  await checkRateLimit(identifierHash)

  const { data: club } = await admin
    .from('clubs')
    .select('id')
    .eq('code_normalized', input.clubCode)
    .maybeSingle()

  if (!club) {
    await recordFailure(identifierHash)
    throw new Error('동호회 코드, 닉네임 또는 PIN을 확인해 주세요.')
  }

  const { data: credential } = await admin
    .from('member_credentials')
    .select('auth_email')
    .eq('club_id', club.id)
    .eq('login_name_normalized', normalizedName)
    .maybeSingle()

  if (!credential) {
    await recordFailure(identifierHash)
    throw new Error('동호회 코드, 닉네임 또는 PIN을 확인해 주세요.')
  }

  try {
    const session = await signIn(credential.auth_email, input.pin)
    await clearFailures(identifierHash)
    return session
  } catch (error) {
    await recordFailure(identifierHash)
    throw error
  }
}

async function findOrCreateClub(clubCode: string) {
  const { data: existing } = await admin
    .from('clubs')
    .select('id, name')
    .eq('code_normalized', clubCode)
    .maybeSingle()
  if (existing) return { club: existing, created: false }

  const joinCodeHash = await sha256(`${pinPepper}:${clubCode}`)
  const { data: created, error } = await admin
    .from('clubs')
    .insert({
      name: `${clubCode} 배드민턴`,
      code_normalized: clubCode,
      join_code_hash: joinCodeHash,
    })
    .select('id, name')
    .single()

  if (!error && created) return { club: created, created: true }

  const { data: racedClub } = await admin
    .from('clubs')
    .select('id, name')
    .eq('code_normalized', clubCode)
    .single()
  if (!racedClub) throw new Error('동호회를 준비하지 못했습니다.')
  return { club: racedClub, created: false }
}

async function register(input: ReturnType<typeof validateAuthInput>) {
  const normalizedName = normalizeNickname(input.nickname)
  const { club, created: clubCreated } = await findOrCreateClub(input.clubCode)

  const { data: duplicate } = await admin
    .from('member_credentials')
    .select('member_id')
    .eq('club_id', club.id)
    .eq('login_name_normalized', normalizedName)
    .maybeSingle()
  if (duplicate) {
    throw new Error('같은 동호회에서 이미 사용 중인 닉네임입니다.')
  }

  const { count } = await admin
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', club.id)
  const role = (count ?? 0) === 0 ? 'owner' : 'member'
  const authEmail = `member-${crypto.randomUUID()}@members.kokkok.invalid`
  const password = await buildInternalPassword(authEmail, input.pin)

  const { data: createdUser, error: createUserError } =
    await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        club_id: club.id,
        nickname: input.nickname,
      },
    })

  if (createUserError || !createdUser.user) {
    throw new Error('회원 계정을 만들지 못했습니다.')
  }

  const userId = createdUser.user.id
  try {
    const { error: memberError } = await admin.from('members').insert({
      id: userId,
      club_id: club.id,
      nickname: input.nickname,
      nickname_normalized: normalizedName,
      role,
    })
    if (memberError) throw memberError

    const { error: credentialError } = await admin
      .from('member_credentials')
      .insert({
        member_id: userId,
        club_id: club.id,
        login_name_normalized: normalizedName,
        auth_email: authEmail,
      })
    if (credentialError) throw credentialError

    if (role === 'owner') {
      await admin
        .from('clubs')
        .update({ created_by: userId })
        .eq('id', club.id)
        .is('created_by', null)
    }

    return await signIn(authEmail, input.pin)
  } catch (error) {
    await admin.auth.admin.deleteUser(userId)
    if (clubCreated) {
      await admin.from('clubs').delete().eq('id', club.id)
    }
    console.error('회원 등록 롤백:', error)
    throw new Error('회원 등록을 완료하지 못했습니다.')
  }
}

async function resetPin(request: Request, body: AuthBody) {
  if (!body.memberId || !/^\d{6}$/.test(body.newPin ?? '')) {
    throw new Error('회원과 새 6자리 PIN을 확인해 주세요.')
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('관리자 로그인이 필요합니다.')

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) throw new Error('관리자 로그인이 필요합니다.')

  const { data: actor } = await admin
    .from('members')
    .select('club_id, role, is_active')
    .eq('id', userData.user.id)
    .single()
  const { data: target } = await admin
    .from('member_credentials')
    .select('member_id, club_id, auth_email')
    .eq('member_id', body.memberId)
    .single()

  if (
    !actor?.is_active ||
    actor.role !== 'owner' ||
    !target ||
    target.club_id !== actor.club_id
  ) {
    throw new Error('PIN을 재설정할 권한이 없습니다.')
  }

  const password = await buildInternalPassword(target.auth_email, body.newPin!)
  const { error } = await admin.auth.admin.updateUserById(target.member_id, {
    password,
  })
  if (error) throw new Error('PIN을 재설정하지 못했습니다.')
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
    if (body.action === 'reset-pin') {
      await resetPin(request, body)
      return jsonResponse({ success: true })
    }

    const input = validateAuthInput(body)
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('cf-connecting-ip') ??
      'unknown'
    const session =
      body.action === 'register'
        ? await register(input)
        : await login(input, clientIp)

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
