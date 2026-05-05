'use client';

/**
 * Identity bubble. Falls back through:
 *   1. Provided image URL (Slack avatar pulled into User.image)
 *   2. Generated geometric initials with a deterministic background color
 */
export function Avatar({
  name,
  email,
  image,
  size = 32,
}: Readonly<{ name: string | null; email: string | null; image: string | null; size?: number }>) {
  const seed = (email ?? name ?? 'x').toLowerCase();
  const initials = deriveInitials(name, email);
  const bg = deriveColor(seed);

  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={name ?? email ?? ''}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="border border-brown-700 object-cover bg-brown-800"
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, backgroundColor: bg, fontSize: Math.round(size * 0.42) }}
      className="border border-brown-700 flex items-center justify-center text-brown-900 font-semibold uppercase tracking-tight"
    >
      {initials}
    </div>
  );
}

function deriveInitials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2);
    return (parts[0][0] + parts[parts.length - 1][0]).slice(0, 2);
  }
  if (email) return email.slice(0, 2);
  return '??';
}

// Generate a desaturated cream-tinted color from a string hash.
function deriveColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  // OKLCH-ish via HSL approximation; keep light + low chroma so the cream UI stays cohesive.
  return `hsl(${hue}, 30%, 78%)`;
}
