export function Avatar({
  name,
  url,
  size = 32,
}: {
  name: string
  url?: string | null
  size?: number
}) {
  const style = { width: size, height: size }

  if (url) {
    return (
      <img
        className="avatar-photo"
        src={url}
        alt={`${name} 프로필 사진`}
        style={style}
        loading="lazy"
      />
    )
  }

  return (
    <span
      className="avatar-fallback"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  )
}
