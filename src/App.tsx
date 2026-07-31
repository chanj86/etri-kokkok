import { AppShell } from './components/AppShell'
import { NoticeToast } from './components/NoticeToast'
import { LoadingScreen } from './components/ui'
import { useApp } from './hooks/useApp'
import { usePathname } from './lib/navigation'
import { GamePage } from './pages/GamePage'
import { HomePage } from './pages/HomePage'
import { LessonPage } from './pages/LessonPage'
import { LoginPage } from './pages/LoginPage'
import { ProfilePage } from './pages/ProfilePage'
import { RecordsPage } from './pages/RecordsPage'

export default function App() {
  const { ready, authenticated } = useApp()
  const pathname = usePathname()

  if (!ready) return <LoadingScreen />

  const page = {
    '/': <HomePage />,
    '/lesson': <LessonPage />,
    '/game': <GamePage />,
    '/records': <RecordsPage />,
    '/profile': <ProfilePage />,
  }[pathname]

  return (
    <>
      {authenticated ? (
        <AppShell>{page}</AppShell>
      ) : (
        <LoginPage />
      )}
      <NoticeToast />
    </>
  )
}
