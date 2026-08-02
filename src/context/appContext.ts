import { createContext } from 'react'
import type {
  AppSnapshot,
  AuthInput,
  AutoArrangement,
  PostCategory,
  ProfileInput,
} from '../types'

export interface AppNotice {
  type: 'success' | 'error' | 'info'
  message: string
}

export interface AppContextValue {
  ready: boolean
  authenticated: boolean
  demoMode: boolean
  snapshot: AppSnapshot | null
  busyAction: string | null
  notice: AppNotice | null
  clearNotice: () => void
  signIn: (mode: 'login' | 'register', input: AuthInput) => Promise<void>
  enterDemo: (nickname?: string) => void
  logout: () => Promise<void>
  refresh: () => Promise<void>
  joinLesson: () => Promise<void>
  delayLesson: () => Promise<void>
  cancelLesson: () => Promise<void>
  setGameAttendance: (active: boolean) => Promise<void>
  createGameSlot: (courtName: string) => Promise<void>
  joinGameSlot: (slotId: string) => Promise<void>
  leaveGameSlot: (slotId: string) => Promise<void>
  startGameSlot: (slotId: string) => Promise<void>
  completeGameSlot: (
    slotId: string,
    teamAScore: number,
    teamBScore: number,
  ) => Promise<void>
  cancelGameSlot: (slotId: string) => Promise<void>
  confirmAutoArrangement: (arrangement: AutoArrangement) => Promise<void>
  createPost: (
    category: PostCategory,
    title: string,
    content: string,
  ) => Promise<void>
  deletePost: (postId: string) => Promise<void>
  uploadAvatar: (file: File) => Promise<void>
  saveProfile: (input: ProfileInput) => Promise<void>
  enableNotifications: () => Promise<void>
}

export const AppContext = createContext<AppContextValue | null>(null)
