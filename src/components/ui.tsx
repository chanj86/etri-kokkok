import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'accent'
  children: ReactNode
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={18} />
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark">콕</div>
      <p>동호회 정보를 불러오는 중...</p>
    </div>
  )
}
