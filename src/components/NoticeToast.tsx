import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect } from 'react'
import { useApp } from '../hooks/useApp'

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
}

export function NoticeToast() {
  const { notice, clearNotice } = useApp()

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(clearNotice, notice.type === 'error' ? 6500 : 4200)
    return () => window.clearTimeout(timer)
  }, [clearNotice, notice])

  if (!notice) return null
  const Icon = icons[notice.type]

  return (
    <div className={`notice-toast ${notice.type}`} role="status" aria-live="polite">
      <Icon size={20} />
      <span>{notice.message}</span>
      <button type="button" aria-label="알림 닫기" onClick={clearNotice}>
        <X size={18} />
      </button>
    </div>
  )
}
