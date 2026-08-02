import {
  ChevronRight,
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
import { formatExperience, formatShortDate } from '../lib/format'
import type { CommunityMember, Post, PostCategory } from '../types'

type CommunityTab = 'members' | 'notice' | 'matching'

function PostComposer({
  category,
  busy,
  onSubmit,
  onClose,
}: {
  category: PostCategory
  busy: boolean
  onSubmit: (title: string, content: string) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    await onSubmit(title.trim(), content.trim())
    setTitle('')
    setContent('')
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
      <textarea
        required
        maxLength={2000}
        rows={4}
        placeholder={
          category === 'notice'
            ? '회원들에게 알릴 내용을 입력하세요.'
            : '외부 게임 일정, 모집 인원, 연락 방법 등을 입력하세요.'
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

function PostList({
  posts,
  emptyTitle,
  emptyDescription,
  canDelete,
  busy,
  onDelete,
}: {
  posts: Post[]
  emptyTitle: string
  emptyDescription: string
  canDelete: (post: Post) => boolean
  busy: boolean
  onDelete: (post: Post) => void
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
      {posts.map((post) => (
        <article className="post-item" key={post.id}>
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
          <p className="post-item-content">{post.content}</p>
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
        </article>
      ))}
    </div>
  )
}

export function CommunityPage() {
  const { snapshot, busyAction, createPost, deletePost } = useApp()
  const [tab, setTab] = useState<CommunityTab>('members')
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
          onSubmit={(title, content) => createPost(tab, title, content)}
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
