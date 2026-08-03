import type { ReactNode } from 'react'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'primary',
  busy = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  /** 안내(확인만 있는) 팝업으로 사용할 때 */
  hideCancel?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="modal-card" role="alertdialog" aria-modal="true">
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{message}</div>
        <div className="modal-actions">
          {!hideCancel && (
            <button
              className="button subtle"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            className={`button ${tone === 'danger' ? 'danger' : 'primary'}`}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
