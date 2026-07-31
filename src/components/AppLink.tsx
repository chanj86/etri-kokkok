import type {
  AnchorHTMLAttributes,
  MouseEvent,
  PropsWithChildren,
} from 'react'
import { navigate, type AppPath } from '../lib/navigation'

interface AppLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: AppPath
}

export function AppLink({
  to,
  onClick,
  children,
  ...props
}: PropsWithChildren<AppLinkProps>) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    navigate(to)
  }

  return (
    <a href={to} onClick={handleClick} {...props}>
      {children}
    </a>
  )
}
