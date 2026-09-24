'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';

// Browser → /api/admin only (I-5). A lost session goes back to login and returns to this page.
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; data: { error?: string; code?: string; message?: string } };
export type Api = <T>(url: string, init?: { method?: string; body?: unknown }) => Promise<ApiResult<T>>;

export function adminUrl(slug: string, path: string): string {
  return `/api/admin/${encodeURIComponent(slug)}${path}`;
}

async function request<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      cache: 'no-store',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
  const data: unknown = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, status: res.status, data: data as T } : { ok: false, status: res.status, data: data as { error?: string } };
}

export function useApi(): Api {
  const router = useRouter();
  return useCallback(
    async <T,>(url: string, init?: { method?: string; body?: unknown }) => {
      const r = await request<T>(url, init);
      if (r.status === 401) router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return r;
    },
    [router],
  );
}

// Runs `load` after mount and whenever it changes (outside the effect body, so no sync setState).
export function useLoad(load: () => Promise<void>): void {
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
}

export function errorText(r: { status: number; data: { error?: string; message?: string } }): string {
  if (r.data.message) return r.data.message;
  if (r.status === 0) return 'Network error. Check your connection and try again.';
  if (r.status === 401) return 'Your session expired. Sign in again.';
  if (r.status === 403) return 'You no longer have organizer access to this event.';
  return `Something went wrong (${r.data.error ?? r.status}). Try again.`;
}
