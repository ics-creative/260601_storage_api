import { clearSettings } from './storage/settings';
import { clearAll as clearHistory } from './storage/history';
import { clearAll as clearSnapshot } from './storage/snapshot';

export async function resetAll(): Promise<void> {
  clearSettings();
  await clearHistory();
  await clearSnapshot();
  location.reload();
}
