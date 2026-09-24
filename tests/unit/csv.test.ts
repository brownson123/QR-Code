import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/domain/csv';

describe('toCsv (SPEC §13, I-13)', () => {
  it('T-ANA-04: BOM, CRLF, every field quoted, quotes doubled, formula-injection guard', () => {
    const csv = toCsv(
      ['name', 'note'],
      [
        ['=SUM(A1)', '+1'],
        ['-1', '@x'],
        ['"quoted"', 'a,b'],
        ['line1\nline2', '\tTAB'],
        ['\rCR', null],
        ['Zoë', 42],
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe(
      '﻿' +
        '"name","note"\r\n' +
        `"'=SUM(A1)","'+1"\r\n` +
        `"'-1","'@x"\r\n` +
        '"""quoted""","a,b"\r\n' +
        `"line1\nline2","'\tTAB"\r\n` +
        `"'\rCR",""\r\n` +
        '"Zoë","42"\r\n',
    );
  });

  it('T-ANA-04: an empty table is just the header row', () => {
    expect(toCsv(['a'], [])).toBe('﻿"a"\r\n');
  });
});
