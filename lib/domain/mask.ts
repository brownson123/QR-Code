// SPEC §10.4: volunteers see a masked email (`a***@gmail.com`); organizers see it in full.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  const first = [...email.slice(0, at)][0] ?? '';
  return `${first}***${email.slice(at)}`;
}
