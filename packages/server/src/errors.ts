export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);
export const unauthorized = (message: string) => new ApiError(401, 'UNAUTHORIZED', message);
