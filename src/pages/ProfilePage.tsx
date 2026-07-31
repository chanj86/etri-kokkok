import {
  BellRing,
  Check,
  Clock3,
  LogOut,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { PageHeader, StatusPill } from '../components/ui'
import { useApp } from '../hooks/useApp'
import { formatExperience, genderLabel } from '../lib/format'
import type { Gender } from '../types'

export function ProfilePage() {
  const {
    snapshot,
    demoMode,
    busyAction,
    saveProfile,
    enableNotifications,
    logout,
  } = useApp()
  const member = snapshot?.member
  const [nickname, setNickname] = useState(member?.nickname ?? '')
  const [gender, setGender] = useState<Gender>(member?.gender ?? 'unspecified')
  const [experienceMonths, setExperienceMonths] = useState(
    member?.experienceMonths ?? 0,
  )
  const [priorLessonCount, setPriorLessonCount] = useState(
    member?.priorLessonCount ?? 0,
  )

  if (!snapshot || !member) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void saveProfile({
      nickname,
      gender,
      experienceMonths,
      priorLessonCount,
    })
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="자동 배치의 기준 정보"
        title="내 정보"
        description="구력과 레슨 기록을 최신 상태로 유지하면 더 균형 있게 배치할 수 있어요."
        action={
          <StatusPill tone={demoMode ? 'warning' : 'success'}>
            {demoMode ? '데모 데이터' : '서버 저장'}
          </StatusPill>
        }
      />

      <section className="profile-summary">
        <div className="profile-avatar">
          {member.nickname.slice(0, 1)}
          <span />
        </div>
        <div>
          <span className="section-kicker">{member.clubName}</span>
          <h2>{member.nickname}</h2>
          <p>
            {formatExperience(member.experienceMonths)} ·{' '}
            {genderLabel(member.gender)}
          </p>
        </div>
        <StatusPill tone="accent">
          {member.role === 'owner' ? '관리자' : '회원'}
        </StatusPill>
      </section>

      <form className="surface-card profile-form" onSubmit={submit}>
        <div className="section-heading compact">
          <div>
            <span className="section-kicker">프로필</span>
            <h2>자동 배치 정보</h2>
          </div>
          <UserRound size={21} />
        </div>

        <div className="form-grid">
          <label className="field full">
            <span>닉네임</span>
            <input
              required
              minLength={2}
              maxLength={20}
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>

          <fieldset className="field full">
            <legend>성별</legend>
            <div className="segmented-control">
              {(
                [
                  ['male', '남성'],
                  ['female', '여성'],
                  ['unspecified', '미지정'],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="gender"
                    value={value}
                    checked={gender === value}
                    onChange={() => setGender(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <small>혼복 선호 배치에만 사용하며 순위에는 영향을 주지 않습니다.</small>
          </fieldset>

          <label className="field">
            <span>구력</span>
            <div className="number-input">
              <input
                type="number"
                min="0"
                max="600"
                value={experienceMonths}
                onChange={(event) =>
                  setExperienceMonths(Math.max(0, Number(event.target.value)))
                }
              />
              <em>개월</em>
            </div>
            <small>{formatExperience(experienceMonths)}</small>
          </label>

          <label className="field">
            <span>기존 레슨 횟수</span>
            <div className="number-input">
              <input
                type="number"
                min="0"
                max="9999"
                value={priorLessonCount}
                onChange={(event) =>
                  setPriorLessonCount(Math.max(0, Number(event.target.value)))
                }
              />
              <em>회</em>
            </div>
            <small>앱 사용 전 누적 횟수</small>
          </label>
        </div>

        <button
          className="button primary profile-submit"
          type="submit"
          disabled={busyAction === 'profile-save'}
        >
          <Check size={18} />
          {busyAction === 'profile-save' ? '저장 중...' : '정보 저장'}
        </button>
      </form>

      <section className="settings-list">
        <button
          type="button"
          disabled={busyAction === 'enable-notifications'}
          onClick={() => void enableNotifications()}
        >
          <span className="settings-icon">
            <BellRing size={20} />
          </span>
          <span>
            <strong>레슨 푸시 알림</strong>
            <small>예상 시작 15분 전에 알려드려요</small>
          </span>
          <em>설정</em>
        </button>
        <div>
          <span className="settings-icon">
            <ShieldCheck size={20} />
          </span>
          <span>
            <strong>동호회 데이터 보호</strong>
            <small>다른 동호회와 데이터가 분리되어 있어요</small>
          </span>
          <StatusPill tone="success">보호 중</StatusPill>
        </div>
        <div>
          <span className="settings-icon">
            <Clock3 size={20} />
          </span>
          <span>
            <strong>기준 시간대</strong>
            <small>모든 순서는 서버 시각으로 기록돼요</small>
          </span>
          <em>한국</em>
        </div>
      </section>

      <button
        className="logout-button"
        type="button"
        disabled={busyAction === 'logout'}
        onClick={() => void logout()}
      >
        <LogOut size={18} />
        로그아웃
      </button>
    </div>
  )
}
