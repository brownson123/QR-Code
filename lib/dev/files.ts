import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Dev artifacts only. Writes `<base><ext>`, or `<base>-2<ext>`, `<base>-3<ext>`… if the name is taken,
// so two people with the same first name (or a resent pass) never overwrite each other's QR image.
// The exclusive-create flag ('wx') makes this safe when several drains write at the same time.
export async function writeUniqueFile(dir: string, base: string, ext: string, data: Buffer): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (let n = 1; n <= 10_000; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`;
    const path = join(dir, name);
    try {
      await writeFile(path, data, { flag: 'wx' });
      return path;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`no free file name for ${base}${ext} in ${dir}`);
}
