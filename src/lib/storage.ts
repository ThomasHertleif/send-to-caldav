import browser from "webextension-polyfill";

export interface CalDavSettings {
	serverUrl: string;
	username: string;
	password: string;
}

export const getSettings = async (): Promise<CalDavSettings | null> => {
	const result = await browser.storage.local.get([
		"serverUrl",
		"username",
		"password",
	]);
	if (result.serverUrl && result.username && result.password) {
		return result as unknown as CalDavSettings;
	}
	return null;
};

export const saveSettings = async (settings: CalDavSettings): Promise<void> => {
	await browser.storage.local.set(
		settings as unknown as Record<string, unknown>,
	);
};

export const clearSettings = async (): Promise<void> => {
	await browser.storage.local.clear();
};
