import { ArrowRight, KeyRound, ShieldCheck, Sparkles } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { useApp } from '../hooks/useApp'
import { isSupabaseConfigured } from '../lib/supabase'

const authSchema = z.object({
  clubCode: z.string().trim().min(3, '동호회 코드를 3자 이상 입력해 주세요.'),
  nickname: z.string().trim().min(2, '닉네임을 2자 이상 입력해 주세요.'),
  pin: z.string().regex(/^\d{6}$/, 'PIN은 숫자 6자리로 입력해 주세요.'),
})

export function LoginPage() {
  const { signIn, enterDemo, busyAction } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [clubCode, setClubCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [pin, setPin] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = authSchema.safeParse({ clubCode, nickname, pin })
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? '입력값을 확인해 주세요.')
      return
    }
    setFormError(null)
    try {
      await signIn(mode, result.data)
    } catch {
      // 전역 알림에서 서버 오류를 안내한다.
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand">
          <div className="auth-logo">콕</div>
          <span>콕콕</span>
        </div>
        <div className="auth-message">
          <span className="auth-kicker">
            <Sparkles size={16} />
            우리 동호회 코트 매니저
          </span>
          <h1>
            기다림은 짧게,
            <br />
            게임은 더 즐겁게.
          </h1>
          <p>레슨 순서부터 공정한 게임 순환까지 한곳에서 관리하세요.</p>
        </div>
        <div className="court-lines" aria-hidden="true">
          <div />
          <div />
          <div />
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <p className="eyebrow">{mode === 'login' ? '다시 만나 반가워요' : '새 회원 등록'}</p>
            <h2>{mode === 'login' ? '동호회 입장하기' : '동호회 가입하기'}</h2>
            <p>이메일 없이 동호회 코드와 PIN으로 간편하게 시작합니다.</p>
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
              <span>동호회 코드</span>
              <input
                autoCapitalize="characters"
                autoComplete="organization"
                placeholder="예: KOKKOK24"
                value={clubCode}
                onChange={(event) => setClubCode(event.target.value.toUpperCase())}
              />
            </label>
            <label>
              <span>닉네임</span>
              <input
                autoComplete="username"
                placeholder="동호회에서 사용하는 이름"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </label>
            <label>
              <span>6자리 PIN</span>
              <div className="input-with-icon">
                <KeyRound size={18} />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  maxLength={6}
                  placeholder="••••••"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                />
              </div>
            </label>

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
            PIN 원문은 저장하지 않으며 동호회별 데이터는 안전하게 분리됩니다.
          </p>
        </div>
      </section>
    </main>
  )
}
