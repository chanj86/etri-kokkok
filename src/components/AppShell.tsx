import {
  CircleUserRound,
  ClipboardList,
  Gamepad2,
  Home,
  RefreshCw,
  Trophy,
} from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { useApp } from '../hooks/useApp'
import { type AppPath, usePathname } from '../lib/navigation'
import { AppLink } from './AppLink'

const navigation: Array<{
  to: AppPath
  label: string
  icon: typeof Home
}> = [
  { to: '/', label: '홈', icon: Home },
  { to: '/lesson', label: '레슨', icon: ClipboardList },
  { to: '/game', label: '게임', icon: Gamepad2 },
  { to: '/records', label: '기록', icon: Trophy },
  { to: '/profile', label: '내 정보', icon: CircleUserRound },
]

export function AppShell({ children }: PropsWithChildren) {
  const { snapshot, demoMode, busyAction, refresh } = useApp()
  const pathname = usePathname()

  if (!snapshot) return null

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            콕
          </div>
          <div>
            <p className="eyebrow">{snapshot.member.clubName}</p>
            <strong>안녕하세요, {snapshot.member.nickname}님</strong>
          </div>
        </div>
        <div className="topbar-actions">
          {demoMode && <span className="demo-badge">데모</span>}
          <button
            className="icon-button"
            type="button"
            aria-label="새로고침"
            disabled={busyAction === 'refresh'}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={19}
              className={busyAction === 'refresh' ? 'spin' : undefined}
            />
          </button>
        </div>
      </header>

      <main className="page-container">
        {children}
      </main>

      <nav className="bottom-nav" aria-label="주 메뉴">
        {navigation.map(({ to, label, icon: Icon }) => (
          <AppLink
            key={to}
            to={to}
            className={`bottom-nav-item${pathname === to ? ' active' : ''}`}
          >
            <Icon size={21} strokeWidth={2.2} />
            <span>{label}</span>
          </AppLink>
        ))}
      </nav>
    </div>
  )
}
