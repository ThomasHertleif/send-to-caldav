import "webextension-polyfill";
import { getSettings, saveSettings, type CalDavSettings } from "../lib/storage";
import { CalDavClient } from "../lib/caldav";

const form = document.getElementById("settings-form") as HTMLFormElement;
const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const passwordInput = document.getElementById("password") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;

// Load settings on startup
document.addEventListener("DOMContentLoaded", async () => {
	const settings = await getSettings();
	if (settings) {
		serverUrlInput.value = settings.serverUrl;
		usernameInput.value = settings.username;
		passwordInput.value = settings.password;
	}
});

const showStatus = (message: string, type: "success" | "error") => {
	statusDiv.textContent = message;
	statusDiv.className = type;
	statusDiv.style.display = "block";

	if (type === "success") {
		setTimeout(() => {
			statusDiv.style.display = "none";
		}, 5000);
	}
};

form.addEventListener("submit", async (e) => {
	e.preventDefault();

	// Disable button
	saveBtn.disabled = true;
	saveBtn.textContent = "Testing Connection...";
	statusDiv.style.display = "none";

	const settings: CalDavSettings = {
		serverUrl: serverUrlInput.value.trim(),
		username: usernameInput.value.trim(),
		password: passwordInput.value,
	};

	try {
		const client = new CalDavClient(settings);
		const isConnected = await client.checkConnection();

		if (isConnected) {
			await saveSettings(settings);
			showStatus("Settings saved and connection verified!", "success");
		} else {
			showStatus(
				"Could not connect to CalDAV server. Please check your URL and credentials.",
				"error",
			);
		}
	} catch (error) {
		console.error(error);
		showStatus(
			"An unexpected error occurred: " +
				(error instanceof Error ? error.message : String(error)),
			"error",
		);
	} finally {
		saveBtn.disabled = false;
		saveBtn.textContent = "Save & Test Connection";
	}
});
