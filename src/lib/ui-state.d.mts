export function mergeIfCurrent<T extends { id: string }>(shown: T | null, auditId: string, fresh: T): T | null;
export function roomControls(state: { ready: boolean; pouring: boolean; fixing: boolean; agentRunning: boolean }): { canRunAudit: boolean; canFix: boolean; canRunAgent: boolean; canSwitchAudit: boolean };
export function latestOnly(): { start(): { token: number; signal: AbortSignal }; isLatest(token: number): boolean; abort(): void };
