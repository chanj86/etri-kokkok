import { useContext } from 'react'
import { AppContext } from '../context/appContext'

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp은 AppProvider 안에서 사용해야 합니다.')
  }
  return context
}
