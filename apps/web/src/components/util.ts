/** Small shared helpers for the web app. */

export function photoUrlOf(filename: string): string {
  return `/photos/${filename}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function dateShort(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function nowDateLabel(): string {
  return new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
