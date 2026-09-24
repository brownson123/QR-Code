'use client';

import { useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl } from '../api';

// §11 / §13: CSVs are built server-side by toCsv() (I-13); these are plain download links.
export function Export({ slug }: { slug: string }) {
  const [includeVoided, setIncludeVoided] = useState(false);
  const link = (kind: string, query = '') => adminUrl(slug, `/export/${kind}${query}`);
  return (
    <>
      <h1>Export</h1>
      <p className={styles.muted}>UTF-8 CSV files that open cleanly in Excel. Times are in UTC and in the event’s timezone.</p>
      <ul style={{ display: 'grid', gap: 12, padding: 0, listStyle: 'none' }}>
        <li>
          <a className={`button ${styles.linkButton}`} href={link('participants.csv')} download>
            Participants CSV
          </a>
        </li>
        <li className={styles.toolbar} style={{ alignItems: 'center' }}>
          <a className={`button ${styles.linkButton}`} href={link('scans.csv', includeVoided ? '?includeVoided=1' : '')} download>
            Scans CSV
          </a>
          <label className={styles.check}>
            <input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} /> Include voided scans
          </label>
        </li>
        <li>
          <a className={`button ${styles.linkButton}`} href={link('summary.csv')} download>
            Checkpoint summary CSV
          </a>
        </li>
      </ul>
    </>
  );
}
