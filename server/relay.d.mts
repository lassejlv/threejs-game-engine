/** Starts a relay. Resolves with its port and a `close` function. */
export function startRelay(options?: { port?: number; host?: string }): Promise<{ port: number; close(): Promise<void> }>
