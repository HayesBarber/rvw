export function reviewSourceLabel(source, compact = false) {
  switch (source?.kind) {
    case 'working-tree': return 'working tree'
    case 'commit-range': {
      const revision = (value) => compact && /^[a-f0-9]{40,64}$/.test(value) ? value.slice(0, 7) : value
      return `${revision(source.base)}..${revision(source.head)}`
    }
    case 'pull-request': return `PR #${source.number}`
    default: return ''
  }
}
