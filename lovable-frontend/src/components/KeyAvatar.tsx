type Props = { pfp: string | null; name: string; size?: number; className?: string };

// pfp is either a URL, a color hex, or null
export function KeyAvatar({ pfp, name, size = 36, className = "" }: Props) {
  if (pfp && (pfp.startsWith("data:") || pfp.startsWith("http"))) {
    return (
      <img
        src={pfp}
        alt={name}
        style={{ width: size, height: size }}
        className={`rounded-md object-cover ${className}`}
      />
    );
  }
  const initial = name.slice(0, 2).toUpperCase();
  // Use pfp as a color if it looks like hex, otherwise use a fallback
  const bg = pfp && pfp.startsWith("#") ? pfp : "#a3a3a3";
  return (
    <div
      style={{ width: size, height: size, backgroundColor: bg }}
      className={`flex items-center justify-center rounded-md font-bold text-background ${className}`}
    >
      <span style={{ fontSize: size * 0.4 }}>{initial}</span>
    </div>
  );
}
