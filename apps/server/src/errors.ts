/** HTTP error recognized by the API error handler (both modules import this). */
export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
