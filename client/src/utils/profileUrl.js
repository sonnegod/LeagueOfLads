export function scrubProfileUrl(value) {
  let input = String(value || '').trim().replace(/\s+/g, '');
  if (!input) return '';
  input = input.replace(/^(https?):?\/{1,2}/i, '$1://');
  if (input.startsWith('//')) return `https:${input}`;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
}

export function isValidProfileUrl(value) {
  const normalized = scrubProfileUrl(value);
  if (!normalized || normalized.length > 500) return false;

  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.');
  } catch {
    return false;
  }
}
