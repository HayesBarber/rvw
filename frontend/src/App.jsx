import { useEffect, useState } from 'react'
import { getFileReview, getReviewOverview } from './api.js'
import DiffPane from './components/DiffPane.jsx'
import FileTreePane from './components/FileTreePane.jsx'

export default function App() {
  const [overview, setOverview] = useState(null)
  const [selectedPath, setSelectedPath] = useState(null)
  const [overviewError, setOverviewError] = useState(null)
  const [fileRequest, setFileRequest] = useState({
    path: null,
    data: null,
    error: null,
  })

  useEffect(() => {
    let active = true

    getReviewOverview()
      .then((nextOverview) => {
        if (!active) return
        setOverview(nextOverview)
        setSelectedPath(nextOverview.initialPath)
      })
      .catch((error) => {
        if (active) setOverviewError(error.message)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!overview || !selectedPath) return

    let active = true

    getFileReview(overview.review.id, selectedPath)
      .then((nextFileReview) => {
        if (active) {
          setFileRequest({
            path: selectedPath,
            data: nextFileReview,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (active) {
          setFileRequest({
            path: selectedPath,
            data: null,
            error: error.message,
          })
        }
      })

    return () => {
      active = false
    }
  }, [overview, selectedPath])

  if (overviewError) {
    return <main className="fatal-error">Unable to load review: {overviewError}</main>
  }

  if (!overview) {
    return <main className="fatal-error">Loading review…</main>
  }

  if (!selectedPath) {
    return <main className="fatal-error">No changes to review.</main>
  }

  const fileLoading = fileRequest.path !== selectedPath
  const fileReview = fileLoading ? null : fileRequest.data
  const fileError = fileLoading ? null : fileRequest.error

  return (
    <main className="review-shell">
      <section className="pane tree-pane">
        <header className="pane-header">
          <strong>{overview.review.repository.name}</strong>
        </header>
        <div className="pane-body">
          <FileTreePane
            files={overview.files}
            selectedPath={selectedPath}
            onSelectFile={setSelectedPath}
          />
        </div>
      </section>

      <section className="pane diff-pane">
        <header className="pane-header">
          <strong>{selectedPath}</strong>
        </header>
        <div className="pane-body">
          <DiffPane
            fileReview={fileReview}
            loading={fileLoading}
            error={fileError}
          />
        </div>
      </section>
    </main>
  )
}
