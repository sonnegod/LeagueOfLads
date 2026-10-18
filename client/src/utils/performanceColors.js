// Readable red -> yellow -> green values on the performance panels' dark surface.
export function percentageColor(value, { reference = 50, higherIsBetter = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const midpoint = Math.min(99, Math.max(1, reference));
  const high = Math.min(100, midpoint * 2);
  const bounded = Math.min(high, Math.max(0, value));
  const hue = bounded <= midpoint ? bounded / midpoint * 60 : 60 + (bounded - midpoint) / (high - midpoint) * 60;
  return `hsl(${higherIsBetter ? hue : 120 - hue} 75% 68%)`;
}
