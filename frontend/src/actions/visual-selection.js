/** Source-coordinate selection; rendered rows only determine reachable endpoints. */
export function createVisualSelection() {
  let anchor = null
  return {
    begin(rows, cursor) {
      if (!cursor || cursor.lineNumber <= 0 || !rows.some(
        (row) => row[cursor.side] === cursor.lineNumber,
      )) return null
      anchor = { ...cursor }
      return this.extend(cursor)
    },
    clear() { anchor = null },
    get side() { return anchor?.side },
    rows(rows) {
      return anchor
        ? rows.filter((row) => row[anchor.side] > 0)
          .map((row) => ({ index: row.index, [anchor.side]: row[anchor.side] }))
        : rows
    },
    extend(cursor) {
      if (!anchor || !cursor || cursor.side !== anchor.side || cursor.lineNumber <= 0) return null
      return {
        start: Math.min(anchor.lineNumber, cursor.lineNumber),
        end: Math.max(anchor.lineNumber, cursor.lineNumber),
        side: anchor.side,
        endSide: anchor.side,
      }
    },
  }
}
