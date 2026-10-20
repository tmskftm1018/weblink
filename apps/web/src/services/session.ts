export const sessionExpiredEvent = 'weblink:session-expired'

// Keep the response intact so each service retains its own error handling.
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status === 401) window.dispatchEvent(new Event(sessionExpiredEvent))
  return response
}
