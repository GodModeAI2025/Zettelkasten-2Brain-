export interface IpcError {
  code:
    | 'GIT_AUTH_FAILED'
    | 'GIT_CONFLICT'
    | 'GIT_NOT_CLONED'
    | 'API_KEY_INVALID'
    | 'API_KEY_MISSING'
    | 'VAULT_NOT_FOUND'
    | 'CLAUDE_ERROR'
    | 'FILE_NOT_FOUND'
    | 'PARSE_ERROR'
    | 'NETWORK_ERROR'
    | 'PROJECT_EXISTS'
    | 'PROJECT_NOT_FOUND'
    | 'UNKNOWN';
  message: string;
  details?: unknown;
}

export function toIpcError(err: unknown, fallbackCode: IpcError['code'] = 'UNKNOWN'): IpcError {
  if (err instanceof Error) {
    return { code: fallbackCode, message: err.message };
  }
  return { code: fallbackCode, message: String(err) };
}
