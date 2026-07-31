import {
  ArrowRight,
  LockKeyhole,
  Phone,
  ShieldCheck,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { useApp } from '../hooks/useApp'
import { isSupabaseConfigured } from '../lib/supabase'

const phoneSchema = z.string().trim().refine((value) => {
  const digits = value.replace(/\D/g, '')
  return /^010\d{8}$/.test(digits) || /^8210\d{8}$/.test(digits)
}, '휴대전화 번호를 010-1234-5678 형식으로 입력해 주세요.')

const loginSchema = z.object({
  phone: phoneSchema,
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상 입력해 주세요.')
    .max(64, '비밀번호는 64자 이하로 입력해 주세요.'),
})

const registerSchema = loginSchema
  .extend({
    nickname: z
      .string()
      .trim()
      .min(2, '닉네임을 2자 이상 입력해 주세요.')
      .max(20, '닉네임은 20자 이하로 입력해 주세요.'),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: '비밀번호 확인이 일치하지 않습니다.',
    path: ['passwordConfirm'],
  })

function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

const initialPhone = ''

export function LoginPage() {
  const { signIn, enterDemo, busyAction } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState(initialPhone)
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const input = { phone, nickname, password, passwordConfirm }
    const result =
      mode === 'login'
        ? loginSchema.safeParse(input)
        : registerSchema.safeParse(input)
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? '입력값을 확인해 주세요.')
      return
    }
    setFormError(null)
    try {
      await signIn(mode, {
        phone: result.data.phone,
        password: result.data.password,
        nickname: mode === 'register' ? nickname.trim() : undefined,
      })
    } catch {
      // 전역 알림에서 서버 오류를 안내한다.
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <img
          className="auth-visual-image"
          src="/etri-badminton-hero.png"
          alt="점프 스매시를 하는 배드민턴 선수 일러스트"
        />
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <p className="eyebrow">{mode === 'login' ? '다시 만나 반가워요' : '새 회원 등록'}</p>
            <h2>{mode === 'login' ? 'ETRI 콕콕 로그인' : 'ETRI 회원 등록'}</h2>
            <p>휴대전화 번호와 비밀번호로 간편하게 시작합니다.</p>
          </div>

          {!isSupabaseConfigured && (
            <div className="demo-callout">
              <div>
                <strong>서버 연결 전 미리보기</strong>
                <span>예시 데이터로 모든 화면을 둘러볼 수 있어요.</span>
              </div>
              <button type="button" onClick={() => enterDemo('민준')}>
                데모 입장
                <ArrowRight size={17} />
              </button>
            </div>
          )}

          <div className="auth-tabs" role="tablist" aria-label="인증 방식">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => setMode('login')}
            >
              로그인
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'active' : ''}
              onClick={() => setMode('register')}
            >
              신규 가입
            </button>
          </div>

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>휴대전화 번호</span>
              <div className="input-with-icon">
                <Phone size={18} />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="010-1234-5678"
                  value={phone}
                  onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                />
              </div>
            </label>
            {mode === 'register' && (
              <label>
                <span>이름 또는 닉네임</span>
                <input
                  autoComplete="name"
                  placeholder="ETRI에서 사용하는 이름"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label>
              <span>비밀번호</span>
              <div className="input-with-icon">
                <LockKeyhole size={18} />
                <input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={8}
                  maxLength={64}
                  placeholder="8자 이상 입력"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </label>
            {mode === 'register' && (
              <label>
                <span>비밀번호 확인</span>
                <div className="input-with-icon">
                  <LockKeyhole size={18} />
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={64}
                    placeholder="비밀번호 다시 입력"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                  />
                </div>
              </label>
            )}

            {formError && <p className="field-error">{formError}</p>}

            <button
              className="button primary auth-submit"
              type="submit"
              disabled={busyAction === 'auth'}
            >
              {busyAction === 'auth'
                ? '확인 중...'
                : mode === 'login'
                  ? '입장하기'
                  : '가입하고 시작하기'}
              <ArrowRight size={18} />
            </button>
          </form>

          <p className="security-note">
            <ShieldCheck size={17} />
            전화번호는 로그인 식별용 해시로 변환되며 원문을 저장하지 않습니다.
          </p>
        </div>
      </section>
    </main>
  )
}
