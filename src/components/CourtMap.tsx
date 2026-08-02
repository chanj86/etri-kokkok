import { COURT_NAMES, type CourtName, type GameSlot } from '../types'

type CourtStatus = 'free' | 'open' | 'playing'

interface CourtInfo {
  name: CourtName
  status: CourtStatus
  playerCount: number
  elapsedLabel: string | null
}

const COURT_X = [115, 395, 675]
const COURT_WIDTH = 220
const COURT_HEIGHT = 300
const COURT_Y = 100

const PALETTE: Record<
  CourtStatus,
  { fill: string; stroke: string; line: string }
> = {
  free: { fill: '#1f845a', stroke: '#164b35', line: '#ffffff' },
  open: { fill: '#d97008', stroke: '#8f4700', line: '#ffffff' },
  playing: { fill: '#8590a2', stroke: '#596577', line: '#dcdfe4' },
}

function formatElapsed(startedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}분 경과`
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 경과`
}

function statusLabel(court: CourtInfo): string {
  if (court.status === 'playing') return '게임중'
  if (court.status === 'open') return `모집중 ${court.playerCount}/4`
  return '사용 가능'
}

export function resolveCourts(slots: GameSlot[], now: number): CourtInfo[] {
  return COURT_NAMES.map((name) => {
    const activeSlot = slots.find(
      (slot) =>
        slot.courtName === name &&
        (slot.status === 'open' || slot.status === 'playing'),
    )
    if (!activeSlot) {
      return { name, status: 'free' as const, playerCount: 0, elapsedLabel: null }
    }
    if (activeSlot.status === 'playing') {
      return {
        name,
        status: 'playing' as const,
        playerCount: activeSlot.players.length,
        elapsedLabel: activeSlot.startedAt
          ? formatElapsed(activeSlot.startedAt, now)
          : null,
      }
    }
    return {
      name,
      status: 'open' as const,
      playerCount: activeSlot.players.length,
      elapsedLabel: null,
    }
  })
}

function DoorLabel({
  x,
  y,
  vertical = false,
}: {
  x: number
  y: number
  vertical?: boolean
}) {
  const width = vertical ? 30 : 78
  const height = vertical ? 110 : 30

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="#101214" />
      <text
        x={x + width / 2}
        y={y + height / 2}
        fill="#ffffff"
        fontSize="16"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
        transform={
          vertical
            ? `rotate(90 ${x + width / 2} ${y + height / 2})`
            : undefined
        }
      >
        출입구
      </text>
    </g>
  )
}

function Court({
  info,
  x,
  selected,
  selectable,
  onSelect,
}: {
  info: CourtInfo
  x: number
  selected: boolean
  selectable: boolean
  onSelect?: () => void
}) {
  const colors = PALETTE[info.status]
  const y = COURT_Y
  const w = COURT_WIDTH
  const h = COURT_HEIGHT
  const netY = y + h / 2
  const clickable = selectable && info.status === 'free' && Boolean(onSelect)

  return (
    <g
      role={clickable ? 'button' : undefined}
      aria-label={`${info.name} ${statusLabel(info)}`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={clickable ? onSelect : undefined}
    >
      {selected && (
        <rect
          x={x - 7}
          y={y - 7}
          width={w + 14}
          height={h + 14}
          rx={8}
          fill="none"
          stroke="#0c66e4"
          strokeWidth={4}
        />
      )}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={5}
      />
      {/* 코트 라인 */}
      <rect
        x={x + 10}
        y={y + 10}
        width={w - 20}
        height={h - 20}
        fill="none"
        stroke={colors.line}
        strokeWidth={2}
      />
      <line x1={x + 32} y1={y + 10} x2={x + 32} y2={y + h - 10} stroke={colors.line} strokeWidth={2} />
      <line x1={x + w - 32} y1={y + 10} x2={x + w - 32} y2={y + h - 10} stroke={colors.line} strokeWidth={2} />
      <line x1={x + 10} y1={netY - 44} x2={x + w - 10} y2={netY - 44} stroke={colors.line} strokeWidth={2} />
      <line x1={x + 10} y1={netY + 44} x2={x + w - 10} y2={netY + 44} stroke={colors.line} strokeWidth={2} />
      <line x1={x + w / 2} y1={y + 10} x2={x + w / 2} y2={netY - 44} stroke={colors.line} strokeWidth={2} />
      <line x1={x + w / 2} y1={netY + 44} x2={x + w / 2} y2={y + h - 10} stroke={colors.line} strokeWidth={2} />

      {/* 네트 밴드와 코트 이름 */}
      <rect x={x - 6} y={netY - 17} width={w + 12} height={34} fill="#ffffff" stroke="#101214" strokeWidth={1.5} />
      <text
        x={x + w / 2}
        y={netY}
        fill="#101214"
        fontSize="21"
        fontWeight="800"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {info.name}
      </text>

      {/* 상태 표기 */}
      <text
        x={x + w / 2}
        y={netY + 66}
        fill="#ffffff"
        fontSize="18"
        fontWeight="800"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {statusLabel(info)}
      </text>
      {info.elapsedLabel && (
        <text
          x={x + w / 2}
          y={netY + 92}
          fill="#ffffff"
          fontSize="15"
          fontWeight="600"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {info.elapsedLabel}
        </text>
      )}
    </g>
  )
}

export function CourtMap({
  slots,
  now,
  selectedCourt = null,
  onSelectCourt,
}: {
  slots: GameSlot[]
  now: number
  selectedCourt?: CourtName | null
  onSelectCourt?: (court: CourtName) => void
}) {
  const courts = resolveCourts(slots, now)

  return (
    <svg
      className="court-map"
      viewBox="0 0 1010 500"
      role="img"
      aria-label="코트 배치도"
    >
      <rect x={6} y={6} width={998} height={488} fill="#ffffff" stroke="#101214" strokeWidth={3} />
      <DoorLabel x={6} y={6} />
      <DoorLabel x={6} y={464} />
      <DoorLabel x={974} y={300} vertical />
      {courts.map((info, index) => (
        <Court
          key={info.name}
          info={info}
          x={COURT_X[index]}
          selected={selectedCourt === info.name}
          selectable={Boolean(onSelectCourt)}
          onSelect={
            onSelectCourt ? () => onSelectCourt(info.name) : undefined
          }
        />
      ))}
    </svg>
  )
}
