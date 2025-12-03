export interface CalDavSettings {
  serverUrl: string;
  username: string;
  password: string;
  calendarPath?: string; // The specific calendar href if known
}

export const getSettings = async (): Promise<CalDavSettings | null> => {
  const result = await browser.storage.local.get(['serverUrl', 'username', 'password', 'calendarPath']);
  if (result.serverUrl && result.username && result.password) {
    return result as CalDavSettings;
  }
  return null;
};

export const saveSettings = async (settings: CalDavSettings): Promise<void> => {
  await browser.storage.local.set(settings);
};

export const clearSettings = async (): Promise<void> => {
  await browser.storage.local.clear();
};
