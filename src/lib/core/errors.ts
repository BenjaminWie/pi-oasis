export class AppError extends Error {
  constructor(
    public message: string,
    public status: number = 500,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ActionResponse<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status: number };

export function success<T>(data: T): ActionResponse<T> {
  return { ok: true, data };
}

export function fail(message: string, status: number = 400, code?: string): ActionResponse<never> {
  return { ok: false, error: message, status, code };
}

export async function handleServerError<T>(fn: () => Promise<T>): Promise<ActionResponse<T>> {
  try {
    const result = await fn();
    return success(result);
  } catch (e: any) {
    console.error("[ServerError]", e);
    if (e instanceof AppError) {
      return fail(e.message, e.status, e.code);
    }
    return fail(e.message || "An unexpected error occurred", 500);
  }
}
