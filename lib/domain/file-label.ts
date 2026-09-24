// Dev artifacts only (console mail QR images, seed QR images): a readable, filesystem-safe file name
// such as "Demo-Hack-Day-Zoe". Pure. Never used for anything sent to real participants.

const MAX_LENGTH = 80;

export function toFileLabel(...parts: string[]): string {
  const label = parts
    .map((part) =>
      part
        .normalize('NFKD')
        .replace(/\p{M}/gu, '') // Zoë → Zoe, García → Garcia
        .replace(/[^A-Za-z0-9]+/g, '-') // spaces, apostrophes, slashes, dots → "-"
        .replace(/^-+|-+$/g, ''),
    )
    .filter((part) => part.length > 0)
    .join('-')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, '');
  return label || 'pass';
}
