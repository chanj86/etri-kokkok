import { useEffect } from 'react'
import { AppShell } from './components/AppShell'
import { NoticeToast } from './components/NoticeToast'
import { LoadingScreen } from './components/ui'
import { useApp } from './hooks/useApp'
import { usePathname } from './lib/navigation'
import { CommunityPage } from './pages/CommunityPage'
import { GamePage } from './pages/GamePage'
import { HomePage } from './pages/HomePage'
import { LessonPage } from './pages/LessonPage'
import { LoginPage } from './pages/LoginPage'
import { ProfilePage } from './pages/ProfilePage'
import { RecordsPage } from './pages/RecordsPage'

export default function App() {
  const { ready, authenticated, enterDemo } = useApp()
  const pathname = usePathname()

  // ?demo 파라미터로 화면 미리보기를 지원한다. 서버 데이터는 사용하지 않는다.
  useEffect(() => {
    if (!ready || authenticated) return
    if (new URLSearchParams(window.location.search).has('demo')) {
      enterDemo('민준')
    }
  }, [ready, authenticated, enterDemo])

  if (!ready) return <LoadingScreen />

  const page = {
    '/': <HomePage />,
    '/lesson': <LessonPage />,
    '/game': <GamePage />,
    '/community': <CommunityPage />,
    '/records': <RecordsPage />,
    '/profile': <ProfilePage />,
  }[pathname]

  return (
    <>
      {authenticated ? <AppShell>{page}</AppShell> : <LoginPage />}
      <NoticeToast />
    </>
  )
}
