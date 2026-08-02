import { X } from 'lucide-react'
import type { CommunityMember } from '../types'
import { formatExperience, formatShortDate, genderLabel } from '../lib/format'
import { Avatar } from './Avatar'

export function MemberDetailModal({
  member,
  onClose,
}: {
  member: CommunityMember | null
  onClose: () => void
}) {
  if (!member) return null

  const winRate = member.games
    ? Math.round((member.wins / member.games) * 100)
    : 0
  const singlesGames = member.singlesGames ?? 0
  const singlesWins = member.singlesWins ?? 0
  const doublesGames = member.doublesGames ?? 0
  const doublesWins = member.doublesWins ?? 0

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-card member-detail" role="dialog" aria-modal="true">
        <button
          className="modal-close"
          type="button"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <div className="member-detail-head">
          <Avatar name={member.nickname} url={member.avatarUrl} size={56} />
          <div>
            <h2>
              {member.nickname}
              {member.role === 'owner' && (
                <span className="lozenge info">관리자</span>
              )}
            </h2>
            <p>
              {genderLabel(member.gender)} · 구력{' '}
              {formatExperience(member.experienceMonths)}
            </p>
          </div>
        </div>

        <div className="member-detail-stats">
          <div>
            <span>전적</span>
            <strong>
              {member.wins}승 {member.losses}패
            </strong>
          </div>
          <div>
            <span>승률</span>
            <strong>{member.games ? `${winRate}%` : '—'}</strong>
          </div>
          <div>
            <span>게임 수</span>
            <strong>{member.games}회</strong>
          </div>
          <div>
            <span>누적 레슨</span>
            <strong>{member.lessonCount}회</strong>
          </div>
        </div>

        <p className="member-detail-breakdown">
          단식 {singlesWins}승 {singlesGames - singlesWins}패 · 복식{' '}
          {doublesWins}승 {doublesGames - doublesWins}패
        </p>

        <p className="member-detail-joined">
          가입일 {formatShortDate(member.joinedAt)}
        </p>
      </div>
    </div>
  )
}
