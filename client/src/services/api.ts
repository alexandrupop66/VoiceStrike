import type { DashboardState } from '../types';

export async function getDashboardState(): Promise<DashboardState> {
  const response = await fetch('/api/state');
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json();
}

export async function resetDemo(): Promise<void> {
  const response = await fetch('/api/demo/reset', { method: 'POST' });
  if (!response.ok) throw new Error(`Reset failed: ${response.status}`);
}
