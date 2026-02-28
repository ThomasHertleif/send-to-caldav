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
	if (
		typeof result.serverUrl === "string" &&
		typeof result.username === "string" &&
		typeof result.password === "string"
	) {
		return {
			serverUrl: result.serverUrl,
			username: result.username,
			password: result.password,
		};
	}
	return null;
};

export const saveSettings = async (settings: CalDavSettings): Promise<void> => {
	await browser.storage.local.set({
		serverUrl: settings.serverUrl,
		username: settings.username,
		password: settings.password,
	});
};

export const clearSettings = async (): Promise<void> => {
	await browser.storage.local.clear();
};
