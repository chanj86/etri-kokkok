import { ArrowRight, LockKeyhole, Phone, ShieldCheck } from 'lucide-react'
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

export function LoginPage() {
  const { signIn, enterDemo, busyAction } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
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
      <div className="auth-column">
        <header className="auth-brand">
          <img className="auth-brand-logo" src="/etri-logo.png" alt="ETRI" />
          <h1 className="auth-brand-name">콕콕</h1>
          <p className="auth-brand-tagline">
            배드민턴 레슨 순서와 게임 순환을 한곳에서
          </p>
        </header>

        <section className="auth-card">
          <div className="segmented" role="tablist" aria-label="인증 방식">
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
                <Phone size={15} />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="010-1234-5678"
                  value={phone}
                  onChange={(event) =>
                    setPhone(formatPhoneInput(event.target.value))
                  }
                />
              </div>
            </label>
            {mode === 'register' && (
              <label>
                <span>이름 또는 닉네임</span>
                <input
                  autoComplete="name"
                  placeholder="동호회에서 사용하는 이름"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label>
              <span>비밀번호</span>
              <div className="input-with-icon">
                <LockKeyhole size={15} />
                <input
                  type="password"
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
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
                  <LockKeyhole size={15} />
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={64}
                    placeholder="비밀번호 다시 입력"
                    value={passwordConfirm}
                    onChange={(event) =>
                      setPasswordConfirm(event.target.value)
                    }
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
                  ? '로그인'
                  : '가입하고 시작하기'}
              <ArrowRight size={15} />
            </button>
          </form>

          {!isSupabaseConfigured && (
            <button
              className="button subtle demo-button"
              type="button"
              onClick={() => enterDemo('민준')}
            >
              데모 데이터로 둘러보기
            </button>
          )}
        </section>

        <p className="auth-note">
          <ShieldCheck size={13} />
          전화번호는 로그인 식별용 해시로 변환되며 원문을 저장하지 않습니다.
        </p>
      </div>
    </main>
  )
}
