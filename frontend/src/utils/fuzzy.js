// Generic fuzzy matching used by searchable frontend controls.
function subsequenceScore(query, candidate) {
  let score = 0
  let previousIndex = -2
  let searchFrom = 0

  for (const character of query) {
    const index = candidate.indexOf(character, searchFrom)
    if (index === -1) return null

    score += 20
    if (index === 0 || '/._- '.includes(candidate[index - 1])) score += 18
    if (index === previousIndex + 1) {
      score += 14
    } else if (previousIndex >= 0) {
      score -= index - previousIndex - 1
    } else {
      score -= index
    }

    previousIndex = index
    searchFrom = index + 1
  }

  return score - (candidate.length - query.length) / 10
}

/**
 * Scores a repository path. A match in the basename always outranks a match
 * found only in its parent directories.
 */
export function fuzzyScore(query, path) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0

  const normalizedPath = path.toLowerCase()
  const basename = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
  const basenameScore = subsequenceScore(normalizedQuery, basename)
  if (basenameScore !== null) {
    let filenameBonus = 10_000
    if (basename === normalizedQuery) filenameBonus = 30_000
    else if (basename.startsWith(normalizedQuery)) filenameBonus = 20_000
    else if (basename.includes(normalizedQuery)) filenameBonus = 15_000
    return filenameBonus + basenameScore
  }

  return subsequenceScore(normalizedQuery, normalizedPath)
}

export function fuzzyFind(paths, query) {
  return paths
    .map((path) => ({ path, score: fuzzyScore(query, path) }))
    .filter((result) => result.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      if (left.path < right.path) return -1
      if (left.path > right.path) return 1
      return 0
    })
    .map((result) => result.path)
}
