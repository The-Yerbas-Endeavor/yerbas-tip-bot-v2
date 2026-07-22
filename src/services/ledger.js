const SCALE = 100000000n;

export function toUnits(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) throw new Error('Invalid amount');
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

export function fromUnits(units) {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
