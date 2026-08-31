export function fileTreeWidthFromPointer(clientX, shellLeft) {
  if (!Number.isFinite(clientX) || !Number.isFinite(shellLeft)) return null
  return Math.max(0, clientX - shellLeft)
}
