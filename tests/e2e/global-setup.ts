import { mkdirSync, writeFileSync } from 'node:fs';

// Marks the start of this e2e run, so the audit project only judges rows and log lines from it.
export default function globalSetup(): void {
  mkdirSync('.e2e', { recursive: true });
  writeFileSync('.e2e/run-started', new Date().toISOString());
}
