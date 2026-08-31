import { useEffect, useState } from 'react'

import { getDiffOverview } from './api.js'
import { RequestStatus } from './request-state.js'

const loadingOverview = Object.freeze({
  status: RequestStatus.LOADING,
  data: null,
  error: null,
})

export function useReviewOverview() {
  const [request, setRequest] = useState(loadingOverview)

  useEffect(() => {
    let active = true

    getDiffOverview()
      .then((overview) => {
        if (active) {
          setRequest({
            status: RequestStatus.SUCCESS,
            data: overview,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (active) {
          setRequest({
            status: RequestStatus.ERROR,
            data: null,
            error: error.message,
          })
        }
      })

    return () => {
      active = false
    }
  }, [])

  return request
}
