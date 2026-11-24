export function networkError(message = "Network error"): Error {
  return Object.assign(new Error(message), { retriable: true });
}

export function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), {
    status,
    retriable: status === 429 || status >= 500,
  });
}
