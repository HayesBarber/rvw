export function reviewSourceLabel(overview, compact = false) {
  return (compact ? overview?.compactSourceLabel : overview?.sourceLabel) ?? ''
}
