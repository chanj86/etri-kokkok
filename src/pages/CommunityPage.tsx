import {
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPin,
  Megaphone,
  PenSquare,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MemberDetailModal } from '../components/MemberDetailModal'
import { EmptyState, PageHeader } from '../components/ui'
import { useApp } from '../hooks/useApp'
import {
  formatExperience,
  formatShortDate,
  toSeoulDateKey,
} from '../lib/format'
import type {
  CommunityMember,
  MatchingPostInput,
  Post,
  PostCategory,
} from '../types'

type CommunityTab = 'members' | 'notice' | 'matching'

function PostComposer({
  category,
  busy,
  onSubmit,
  onClose,
}: {
  category: PostCategory
  busy: boolean
  onSubmit: (
    title: string,
    content: string,
    details?: MatchingPostInput,
  ) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [eventDate, setEventDate] = useState(() => toSeoulDateKey())
  const [eventTime, setEventTime] = useState('19:00')
  const [location, setLocation] = useState('')
  const [capacity, setCapacity] = useState(4)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    if (category === 'matching' && !location.trim()) return
    await onSubmit(
      title.trim(),
      content.trim(),
      category === 'matching'
        ? {
            eventDate,
            eventTime,
            location: location.trim(),
            capacity,
          }
        : undefined,
    )
    setTitle('')
    setContent('')
    setLocation('')
    onClose()
  }

  return (
    <form className="post-composer" onSubmit={(event) => void submit(event)}>
      <div className="post-composer-head">
        <strong>
          {category === 'notice' ? '새 공지 작성' : '새 매칭 글 작성'}
        </strong>
        <button
          className="icon-button small"
          type="button"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <input
        required
        maxLength={80}
        placeholder="제목"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      {category === 'matching' && (
        <div className="post-composer-grid">
          <label className="composer-field">
            <span>날짜</span>
            <input
              required
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </label>
          <label className="composer-field">
            <span>시간</span>
            <input
              required
              type="time"
              value={eventTime}
              onChange={(event) => setEventTime(event.target.value)}
            />
          </label>
          <label className="composer-field">
            <span>모집 인원</span>
            <input
              required
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              value={capacity}
              onChange={(event) =>
                setCapacity(
                  Math.max(1, Math.min(99, Number(event.target.value) || 1)),
                )
              }
            />
          </label>
          <label className="composer-field wide">
            <span>장소</span>
            <input
              required
              maxLength={80}
              placeholder="예: 유성구민체육관"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
        </div>
      )}
      <textarea
        required
        maxLength={2000}
        rows={4}
        placeholder={
          category === 'notice'
            ? '회원들에게 알릴 내용을 입력하세요.'
            : '게임 방식, 실력대, 연락 방법 등을 입력하세요.'
        }
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="post-composer-actions">
        <button className="button primary" type="submit" disabled={busy}>
          등록
        </button>
      </div>
    </form>
  )
}

function MatchingSideRail({
  post,
  busy,
  onJoin,
  onLeave,
}: {
  post: Post
  busy: boolean
  onJoin: (post: Post) => void
  onLeave: (post: Post) => void
}) {
  const joinedCount = post.participants.length
  const isFull = post.capacity !== null && joinedCount >= post.capacity
  const remaining =
    post.capacity !== null ? Math.max(0, post.capacity - joinedCount) : null

  return (
    <div className="post-item-side">
      <span className={`post-capacity${isFull ? ' full' : ''}`}>
        <strong>{joinedCount}</strong>
        {post.capacity !== null ? `/${post.capacity}` : '명'}
      </span>
      <span className="post-capacity-label">
        {post.capacity === null
          ? '참석 인원'
          : isFull
            ? '모집 마감'
            : `${remaining}자리 남음`}
      </span>
      <button
        className={`button ${post.myJoined ? 'danger-soft' : 'primary'} post-join-button`}
        type="button"
        disabled={busy || (!post.myJoined && isFull)}
        onClick={() => (post.myJoined ? onLeave(post) : onJoin(post))}
      >
        {post.myJoined ? '참석 취소' : isFull ? '마감' : '참석'}
      </button>
    </div>
  )
}

function PostList({
  posts,
  emptyTitle,
  emptyDescription,
  canDelete,
  busy,
  onDelete,
  currentMemberId,
  onJoin,
  onLeave,
}: {
  posts: Post[]
  emptyTitle: string
  emptyDescription: string
  canDelete: (post: Post) => boolean
  busy: boolean
  onDelete: (post: Post) => void
  currentMemberId?: string
  onJoin?: (post: Post) => void
  onLeave?: (post: Post) => void
}) {
  if (!posts.length) {
    return (
      <EmptyState
        icon={Megaphone}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <div className="post-list">
      {posts.map((post) => {
        const isMatching = post.category === 'matching' && onJoin && onLeave
        return (
          <article
            className={`post-item${isMatching ? ' with-side' : ''}`}
            key={post.id}
          >
            <div className="post-item-main">
              <div className="post-item-head">
                <strong>{post.title}</strong>
                {canDelete(post) && (
                  <button
                    className="icon-button small danger"
                    type="button"
                    aria-label="글 삭제"
                    disabled={busy}
                    onClick={() => onDelete(post)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {isMatching && post.eventDate && (
                <div className="post-event-chips">
                  <span>
                    <CalendarDays size={12} />
                    {formatShortDate(`${post.eventDate}T12:00:00+09:00`)}
                  </span>
                  {post.eventTime && (
                    <span>
                      <Clock3 size={12} />
                      {post.eventTime}
                    </span>
                  )}
                  {post.location && (
                    <span>
                      <MapPin size={12} />
                      {post.location}
                    </span>
                  )}
                </div>
              )}
              <p className="post-item-content">{post.content}</p>
              {isMatching && post.participants.length > 0 && (
                <div className="post-participants">
                  <span className="post-participants-label">참석</span>
                  {post.participants.map((participant) => (
                    <span
                      className={`post-participant${
                        participant.memberId === currentMemberId ? ' me' : ''
                      }`}
                      key={participant.memberId}
                    >
                      {participant.nickname}
                    </span>
                  ))}
                </div>
              )}
              <div className="post-item-meta">
                <Avatar
                  name={post.authorNickname}
                  url={post.authorAvatarUrl}
                  size={18}
                />
                <span>{post.authorNickname}</span>
                <span className="post-item-date">
                  {formatShortDate(post.createdAt)}
                </span>
              </div>
            </div>
            {isMatching && (
              <MatchingSideRail
                post={post}
                busy={busy}
                onJoin={onJoin}
                onLeave={onLeave}
              />
            )}
          </article>
        )
      })}
    </div>
  )
}

export function CommunityPage() {
  const { snapshot, busyAction, createPost, deletePost, joinPost, leavePost } =
    useApp()
  const [tab, setTab] = useState<CommunityTab>(() => {
    const param = new URLSearchParams(window.location.search).get('tab')
    return param === 'notice' || param === 'matching' ? param : 'members'
  })
  const [composing, setComposing] = useState(false)
  const [detailMember, setDetailMember] = useState<CommunityMember | null>(
    null,
  )
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null)

  if (!snapshot) return null
  const { member, community } = snapshot
  const busy = Boolean(busyAction?.startsWith('community-'))
  const isOwner = member.role === 'owner'

  const canDelete = (post: Post) => post.authorId === member.id || isOwner
  const canWrite = tab === 'matching' || (tab === 'notice' && isOwner)

  const tabs: Array<{ id: CommunityTab; label: string; count: number }> = [
    { id: 'members', label: '회원', count: community.members.length },
    { id: 'notice', label: '공지사항', count: community.notices.length },
    { id: 'matching', label: '외부게임 매칭', count: community.matching.length },
  ]

  return (
    <div className="page-stack">
      <PageHeader
        title="커뮤니티"
        description={`${member.clubName} · 회원 ${community.members.length}명`}
        action={
          canWrite ? (
            <button
              className="button primary"
              type="button"
              onClick={() => setComposing(true)}
            >
              <PenSquare size={14} />
              글쓰기
            </button>
          ) : undefined
        }
      />

      <div className="segmented" role="tablist" aria-label="커뮤니티 메뉴">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => {
              setTab(id)
              setComposing(false)
            }}
          >
            {label}
            <span className="segmented-count">{count}</span>
          </button>
        ))}
      </div>

      {composing && canWrite && (
        <PostComposer
          category={tab}
          busy={busy}
          onSubmit={(title, content, details) =>
            createPost(tab, title, content, details)
          }
          onClose={() => setComposing(false)}
        />
      )}

      {tab === 'members' && (
        <section className="panel">
          {community.members.length ? (
            <ul className="member-list">
              {community.members.map((communityMember) => (
                <li key={communityMember.memberId}>
                  <button
                    type="button"
                    className="attendee-row"
                    onClick={() => setDetailMember(communityMember)}
                  >
                    <Avatar
                      name={communityMember.nickname}
                      url={communityMember.avatarUrl}
                      size={32}
                    />
                    <span className="attendee-name">
                      {communityMember.nickname}
                      {communityMember.memberId === member.id && (
                        <em className="me-tag">나</em>
                      )}
                      {communityMember.role === 'owner' && (
                        <span className="lozenge info">관리자</span>
                      )}
                    </span>
                    <span className="attendee-meta">
                      구력 {formatExperience(communityMember.experienceMonths)}{' '}
                      · {communityMember.wins}승 {communityMember.losses}패
                    </span>
                    <ChevronRight size={14} className="attendee-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UsersRound}
              title="회원이 없습니다"
              description="첫 회원을 초대해 보세요."
            />
          )}
        </section>
      )}

      {tab === 'notice' && (
        <PostList
          posts={community.notices}
          emptyTitle="등록된 공지가 없습니다"
          emptyDescription={
            isOwner
              ? '글쓰기 버튼으로 첫 공지를 등록해 보세요.'
              : '관리자가 공지를 등록하면 여기에 표시됩니다.'
          }
          canDelete={canDelete}
          busy={busy}
          onDelete={setDeleteTarget}
        />
      )}

      {tab === 'matching' && (
        <PostList
          posts={community.matching}
          emptyTitle="등록된 매칭 글이 없습니다"
          emptyDescription="외부 게임 일정이나 교류전 모집 글을 올려 보세요."
          canDelete={canDelete}
          busy={busy}
          onDelete={setDeleteTarget}
          currentMemberId={member.id}
          onJoin={(post) => void joinPost(post.id)}
          onLeave={(post) => void leavePost(post.id)}
        />
      )}

      <MemberDetailModal
        member={detailMember}
        onClose={() => setDetailMember(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="글 삭제"
        message={`"${deleteTarget?.title ?? ''}" 글을 삭제할까요? 삭제한 글은 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          if (deleteTarget) void deletePost(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
