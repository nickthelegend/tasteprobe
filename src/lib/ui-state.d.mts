export function mergeIfCurrent<T extends { id: string }>(shown: T | null, auditId: string, fresh: T): T | null;
export function roomControls(state: { ready: boolean; pouring: boolean; fixing: boolean; agentRunning: boolean }): { canRunAudit: boolean; canFix: boolean; canRunAgent: boolean; canSwitchAudit: boolean };
export function latestOnly(): { start(): { token: number; signal: AbortSignal }; isLatest(token: number): boolean; abort(): void };
export const AGENT_TRY_OPTIONS: number[];
export const AGENT_CALL_OPTIONS: number[];
export function agentChoices(input: { caps?: { maxTries: number; maxAssistantCalls: number }; personaIds: string[]; assistants: number; tries: number; calls: number }): { tryOptions: number[]; callOptions: number[]; tries: number | null; calls: number | null; minAssistantCalls: number };
