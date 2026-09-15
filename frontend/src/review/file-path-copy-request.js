import { useCallback, useMemo } from 'react'

import { copyFilePath } from './api.js'
import { RequestStatus } from './request-state.js'
import { useTransientRequest } from './transient-request.js'

export function filePathCopyRequestMessage(request) {
  if (request.status === RequestStatus.LOADING) return 'Copying path…'
  if (request.status === RequestStatus.ERROR) return request.error
  if (request.status !== RequestStatus.SUCCESS) return ''
  return request.data.format === 'absolute'
    ? 'Copied absolute path'
    : 'Copied relative path'
}

export function useCopyFilePath() {
  const transient = useTransientRequest()

  const copy = useCallback((path, format) => {
    if (!path || transient.status === RequestStatus.LOADING) return false
    transient.start()
    copyFilePath(path, format).then(transient.succeed).catch(transient.fail)
    return true
  }, [transient])

  return useMemo(
    () => ({ ...transient, copy }),
    [copy, transient],
  )
}
