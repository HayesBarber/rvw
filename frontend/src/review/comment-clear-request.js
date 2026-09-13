import { transientRequestMessage, useTransientRequest } from './transient-request.js'

export const clearRequestMessage = (request) => transientRequestMessage(request, {
  inProgress: 'Clearing…',
  completed: 'Cleared',
})

export function useClearComments() {
  return useTransientRequest()
}
