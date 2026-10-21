type Env = Record<string, string | undefined>;
export const DEFAULT_NEBIUS_MODEL: string;
export const REASONING_EFFORTS: string[];
export function reasoningParams(env?: Env): { chat_template_kwargs?: { enable_thinking: boolean }; reasoning_effort?: string };
export function reasoningLabel(env?: Env): string;
export function reasoningText(message: unknown): string;
