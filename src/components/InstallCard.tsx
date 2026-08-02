import { BellRing, Download, Share } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../hooks/useApp'
import { isIos, isStandalone } from '../lib/format'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallCard() {
  const { busyAction, enableNotifications } = useApp()
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(isStandalone())
  const ios = isIos()

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setStandalone(true)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  if (
    standalone &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    return null
  }

  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <section className="install-card">
      <div className="install-copy">
        <strong>홈 화면 설치와 알림</strong>
        <p>앱처럼 빠르게 열고 내 레슨 시작 15분 전에 안내받으세요.</p>
      </div>
      <div className="install-actions">
        {!standalone && installPrompt && (
          <button
            className="button subtle"
            type="button"
            onClick={() => void install()}
          >
            <Download size={14} />
            앱 설치
          </button>
        )}
        {!standalone && ios && !installPrompt && (
          <div className="ios-install-hint">
            <Share size={14} />
            Safari 공유 버튼에서 ‘홈 화면에 추가’를 선택하세요.
          </div>
        )}
        <button
          className="button primary"
          type="button"
          disabled={busyAction === 'enable-notifications'}
          onClick={() => void enableNotifications()}
        >
          <BellRing size={14} />
          알림 켜기
        </button>
      </div>
    </section>
  )
}
