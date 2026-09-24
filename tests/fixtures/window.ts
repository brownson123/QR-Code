// Fixed-window rate limits (rate_limit_hit) reset on window boundaries. A test that must land all its
// requests in one window waits out the boundary first if it is too close.
export async function awaitFreshWindow(windowSeconds: number, neededSeconds = 8): Promise<void> {
  const into = (Date.now() / 1000) % windowSeconds;
  const left = windowSeconds - into;
  if (left < neededSeconds) await new Promise((r) => setTimeout(r, (left + 0.5) * 1000));
}
