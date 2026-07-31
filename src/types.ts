export type Gender = 'male' | 'female' | 'unspecified'
export type MemberRole = 'owner' | 'member'
export type LessonStatus = 'waiting' | 'completed' | 'cancelled'
export type GameSlotStatus = 'open' | 'playing' | 'completed' | 'cancelled'
export type Team = 'A' | 'B'

export interface Member {
  id: string
  clubId: string
  clubName: string
  nickname: string
  role: MemberRole
  gender: Gender
  experienceMonths: number
  priorLessonCount: number
  joinedAt: string
}

export interface LessonBooking {
  id: string
  memberId: string
  nickname: string
  position: number
  joinedAt: string
  estimatedStartAt: string
  status: LessonStatus
  isMine: boolean
}

export interface LessonSnapshot {
  sessionId: string | null
  sessionDate: string
  canJoin: boolean
  queue: LessonBooking[]
  myBooking: LessonBooking | null
  monthlyCount: number
}

export interface GameAttendance {
  id: string
  memberId: string
  nickname: string
  gender: Gender
  experienceMonths: number
  lessonCount: number
  gamesPlayed: number
  lastJoinedCycle: number
  lastGameAt: string | null
  active: boolean
  canJoin: boolean
}

export interface GamePlayer {
  id: string
  memberId: string
  nickname: string
  team: Team
  joinedCycle: number
  skillScore: number
}

export interface GameResult {
  teamAScore: number
  teamBScore: number
  winnerTeam: Team
}

export interface GameSlot {
  id: string
  courtName: string
  status: GameSlotStatus
  source: 'manual' | 'auto'
  createdAt: string
  players: GamePlayer[]
  result: GameResult | null
}

export interface GameSnapshot {
  dayId: string | null
  dayDate: string
  currentCycle: number
  myAttendanceActive: boolean
  myCanJoin: boolean
  attendees: GameAttendance[]
  slots: GameSlot[]
}

export interface AutoCandidate {
  memberId: string
  nickname: string
  team: Team
  skillScore: number
  reason: string
}

export interface AutoArrangement {
  token: string
  courtName: string
  candidates: AutoCandidate[]
  teamAScore: number
  teamBScore: number
  explanation: string
}

export interface RecordSummary {
  wins: number
  losses: number
  games: number
  lessonsThisMonth: number
}

export interface AppSnapshot {
  member: Member
  lesson: LessonSnapshot
  game: GameSnapshot
  records: RecordSummary
}

export interface AuthInput {
  clubCode: string
  nickname: string
  pin: string
}

export interface ProfileInput {
  nickname: string
  gender: Gender
  experienceMonths: number
  priorLessonCount: number
}
