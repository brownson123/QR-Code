// SPEC §6.2, shared by the email (server PNG) and the pass page (client canvas). Client-safe.
// The background MUST be opaque: transparent codes vanish in dark-mode mail clients.
export const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 4,
  width: 600,
  color: { dark: '#000000ff', light: '#ffffffff' },
} as const;
