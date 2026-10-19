export const pct = (value: number) => `${Math.round(value * 100)}%`;
export const ci = ([low, high]: [number, number]) => `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
export const signedPts = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))} pts`;
export const heat = (share: number) => `rgb(var(--heat) / ${(0.06 + Math.min(1, share) * 0.64).toFixed(2)})`;
