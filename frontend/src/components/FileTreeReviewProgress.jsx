export default function FileTreeReviewProgress({ changedFiles, viewedPaths }) {
  const changedFileCount = changedFiles.length
  if (changedFileCount === 0) return null

  const viewed = new Set(viewedPaths)
  const viewedFileCount = changedFiles.filter((file) => viewed.has(file.path)).length

  return (
    <p className="tree-review-progress" role="status">
      <progress value={viewedFileCount} max={changedFileCount} aria-hidden="true" />
      <span>
        {viewedFileCount} of {changedFileCount} {changedFileCount === 1 ? 'file' : 'files'} viewed
      </span>
    </p>
  )
}
