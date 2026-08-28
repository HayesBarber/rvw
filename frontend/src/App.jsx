import { useEffect, useState } from 'react'
import {
  createComment,
  getComments,
  getDiffOverview,
  getFileDiff,
} from './api.js'
import DiffPane from './components/DiffPane.jsx'
import FileTreePane from './components/FileTreePane.jsx'

export default function App() {
  const [overview, setOverview] = useState(null)
  const [selectedPath, setSelectedPath] = useState(null)
  const [overviewError, setOverviewError] = useState(null)
  const [comments, setComments] = useState([])
  const [fileRequest, setFileRequest] = useState({
    path: null,
    data: null,
    error: null,
  })

  useEffect(() => {
    let active = true

    getDiffOverview()
      .then((nextOverview) => {
        if (!active) return
        setOverview(nextOverview)
        setSelectedPath(nextOverview.initialPath)
      })
      .catch((error) => {
        if (active) setOverviewError(error.message)
      })

    getComments()
      .then((nextComments) => {
        if (active) setComments(nextComments)
      })
      .catch(() => {
        // Comments can still be created if the initial list request fails.
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!overview || !selectedPath) return

    let active = true

    getFileDiff(overview.id, selectedPath)
      .then((nextFileDiff) => {
        if (active) {
          setFileRequest({
            path: selectedPath,
            data: nextFileDiff,
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
  const fileDiff = fileLoading ? null : fileRequest.data
  const fileError = fileLoading ? null : fileRequest.error

  async function handleCreateComment(body, target) {
    const comment = await createComment(body, target)
    setComments((current) => (
      current.some((existing) => existing.id === comment.id)
        ? current
        : [...current, comment]
    ))
    return comment
  }

  return (
    <main className="review-shell">
      <section className="pane tree-pane">
        <header className="pane-header">
          <strong>{overview.repository.name}</strong>
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
            key={selectedPath}
            fileDiff={fileDiff}
            loading={fileLoading}
            error={fileError}
            comments={comments}
            onCreateComment={handleCreateComment}
          />
        </div>
      </section>
    </main>
  )
}
