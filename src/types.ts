export type Gender = 'male' | 'female' | 'unspecified'
export type MemberRole = 'owner' | 'member'
export type LessonStatus = 'waiting' | 'completed' | 'cancelled'
export type GameSlotStatus = 'open' | 'playing' | 'completed' | 'cancelled'
export type Team = 'A' | 'B'
export type GameType = 'singles' | 'doubles'

export function gameSlotCapacity(gameType: GameType): number {
  return gameType === 'singles' ? 2 : 4
}

export type CourtName = '코트 A' | '코트 B' | '코트 C'

export const COURT_NAMES: CourtName[] = ['코트 A', '코트 B', '코트 C']
export const LESSON_COURT: CourtName = '코트 A'

export interface Member {
  id: string
  clubId: string
  clubName: string
  nickname: string
  avatarUrl: string | null
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
  /** 이번 달 레슨 참석 날짜 목록 (YYYY-MM-DD) */
  monthlyDates: string[]
}

export interface GameAttendance {
  id: string
  memberId: string
  nickname: string
  avatarUrl: string | null
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
  /** 게스트는 null */
  memberId: string | null
  nickname: string
  isGuest?: boolean
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
  /** 마이그레이션 이전 데이터는 없을 수 있으므로 복식으로 간주 */
  gameType?: GameType
  status: GameSlotStatus
  source: 'manual' | 'auto'
  createdAt: string
  startedAt: string | null
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

export interface PartnerRecord {
  memberId: string
  nickname: string
  games: number
  wins: number
  losses: number
  winRate: number
  lastPlayedAt: string
}

export interface ModeRecord {
  games: number
  wins: number
  losses: number
}

export interface RecordSummary {
  wins: number
  losses: number
  games: number
  /** 마이그레이션 이전 서버에서는 없을 수 있다 */
  singles?: ModeRecord
  doubles?: ModeRecord
  lessonsThisMonth: number
  partnerStats: PartnerRecord[]
}

export type PostCategory = 'notice' | 'matching'

export interface PostParticipant {
  memberId: string
  nickname: string
  avatarUrl: string | null
}

export interface Post {
  id: string
  category: PostCategory
  title: string
  content: string
  authorId: string
  authorNickname: string
  authorAvatarUrl: string | null
  createdAt: string
  /** 매칭 글 전용: 게임 날짜 (YYYY-MM-DD) */
  eventDate: string | null
  /** 매칭 글 전용: 게임 시간 (HH:MM) */
  eventTime: string | null
  location: string | null
  capacity: number | null
  participants: PostParticipant[]
  myJoined: boolean
}

export interface MatchingPostInput {
  eventDate: string
  eventTime: string
  location: string
  capacity: number
}

export interface CommunityMember {
  memberId: string
  nickname: string
  avatarUrl: string | null
  role: MemberRole
  gender: Gender
  experienceMonths: number
  lessonCount: number
  joinedAt: string
  games: number
  wins: number
  losses: number
  singlesGames?: number
  singlesWins?: number
  doublesGames?: number
  doublesWins?: number
}

export interface TeamRanking {
  memberAId: string
  memberANickname: string
  memberAAvatarUrl: string | null
  memberBId: string
  memberBNickname: string
  memberBAvatarUrl: string | null
  games: number
  wins: number
  losses: number
}

export interface CommunitySnapshot {
  members: CommunityMember[]
  notices: Post[]
  matching: Post[]
  teamRankings: TeamRanking[]
}

export interface AppSnapshot {
  member: Member
  lesson: LessonSnapshot
  game: GameSnapshot
  community: CommunitySnapshot
  records: RecordSummary
}

export interface AuthInput {
  phone: string
  password: string
  nickname?: string
}

export interface ProfileInput {
  nickname: string
  gender: Gender
  experienceMonths: number
  priorLessonCount: number
}
