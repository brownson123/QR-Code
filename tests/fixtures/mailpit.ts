// Supabase's local auth mail (magic links) lands in Mailpit. This is Supabase Auth's mail, not our
// EmailProvider, so reading it is not "calling a real email provider".
const MAILPIT = 'http://127.0.0.1:54324';

interface MailpitList {
  messages: Array<{ ID: string; To: Array<{ Address: string }>; Created: string }>;
}

export async function latestMagicLink(email: string, sinceMs: number, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const list = (await res.json()) as MailpitList;
    const msg = list.messages.find((m) => Date.parse(m.Created) >= sinceMs - 2000);
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { Text: string; HTML: string };
      const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/.exec(full.HTML || full.Text)?.[0];
      if (link) return link.replaceAll('&amp;', '&');
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('magic link email did not arrive');
}
