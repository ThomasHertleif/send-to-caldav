import browser from "webextension-polyfill";
import { getSettings } from "../lib/storage";
import { CalDavClient, type CalendarEvent } from "../lib/caldav";
import type { ContextMenuData } from "../background";
import type { ScrapedData } from "../content";

const form = document.getElementById("event-form") as HTMLFormElement;
const settingsWarning = document.getElementById(
	"settings-warning",
) as HTMLDivElement;
const settingsLink = document.getElementById(
	"settings-link",
) as HTMLAnchorElement;
const loadingOverlay = document.getElementById("loading") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;

// Inputs
const titleInput = document.getElementById("title") as HTMLInputElement;
const startInput = document.getElementById("start") as HTMLInputElement;
const endInput = document.getElementById("end") as HTMLInputElement;
const descInput = document.getElementById("description") as HTMLTextAreaElement;
const urlInput = document.getElementById("url") as HTMLInputElement;

let isContextDataLoaded = false;

// Listen for storage changes (in case popup opens before background script saves data)
browser.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes.contextMenuData?.newValue) {
		const contextData = changes.contextMenuData.newValue as ContextMenuData;
		// Only use if fresh (less than 10s old)
		if (Date.now() - contextData.timestamp < 10000) {
			isContextDataLoaded = true;
			if (contextData.title) titleInput.value = contextData.title;
			if (contextData.url) {
				urlInput.value = contextData.url;
				descInput.value = `Source: ${contextData.url}`;
			}
			if (contextData.selection) {
				descInput.value = `${contextData.selection}\n\nSource: ${contextData.url}`;
			}
			// Clear it
			browser.storage.local.remove("contextMenuData");
		}
	}
});

document.addEventListener("DOMContentLoaded", async () => {
	const settings = await getSettings();
	if (!settings) {
		form.classList.add("hidden");
		settingsWarning.classList.remove("hidden");
		return;
	}

	// Initialize default times (start: next hour, end: start + 1h)
	const now = new Date();
	now.setMinutes(0, 0, 0);
	now.setHours(now.getHours() + 1);
	const startStr = toLocalIsoString(now);

	const end = new Date(now);
	end.setHours(end.getHours() + 1);
	const endStr = toLocalIsoString(end);

	startInput.value = startStr;
	endInput.value = endStr;

	// Check for context menu data first
	const storage = await browser.storage.local.get("contextMenuData");
	const contextData = storage.contextMenuData as ContextMenuData;

	if (contextData && Date.now() - contextData.timestamp < 10000) {
		// Use context menu data if it's less than 10 seconds old
		if (contextData.title) titleInput.value = contextData.title;
		if (contextData.url) {
			urlInput.value = contextData.url;
			descInput.value = `Source: ${contextData.url}`;
		}
		if (contextData.selection) {
			descInput.value = `${contextData.selection}\n\nSource: ${contextData.url}`;
		}
		isContextDataLoaded = true;
		// Clear it
		await browser.storage.local.remove("contextMenuData");
	}

	if (!isContextDataLoaded) {
		// Get current tab info
		try {
			const tabs = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (isContextDataLoaded) return;

			if (tabs.length > 0) {
				const tab = tabs[0];
				if (tab.title) titleInput.value = tab.title;
				if (tab.url) {
					urlInput.value = tab.url;
					descInput.value = `Source: ${tab.url}`;
				}

				// Try to get parsed data from content script
				if (tab.id) {
					try {
						const response = (await browser.tabs.sendMessage(tab.id, {
							type: "SCRAPE_PAGE",
						})) as ScrapedData | false;
						if (response && !isContextDataLoaded) {
							if (response.title) titleInput.value = response.title;
							if (response.description)
								descInput.value =
									response.description +
									(tab.url ? `\n\nSource: ${tab.url}` : "");
							// If we had date parsing logic in content script, we would use it here
						}
					} catch (e) {
						// Content script might not be loaded or ready, ignore
						console.log("Could not communicate with content script", e);
					}
				}
			}
		} catch (error) {
			console.error("Error getting tab info:", error);
		}
	}
});

settingsLink.addEventListener("click", () => {
	browser.runtime.openOptionsPage();
});

cancelBtn.addEventListener("click", () => {
	window.close();
});

form.addEventListener("submit", async (e) => {
	e.preventDefault();

	const settings = await getSettings();
	if (!settings) return;

	showLoading(true);
	hideStatus();

	const event: CalendarEvent = {
		title: titleInput.value,
		start: new Date(startInput.value).toISOString(),
		end: new Date(endInput.value).toISOString(),
		description: descInput.value,
		url: urlInput.value,
	};

	try {
		const client = new CalDavClient(settings);
		await client.createEvent(event);
		showStatus("Event created successfully!", "success");
		setTimeout(() => {
			window.close();
		}, 1500);
	} catch (error) {
		console.error(error);
		showStatus(
			"Failed to create event: " +
				(error instanceof Error ? error.message : String(error)),
			"error",
		);
	} finally {
		showLoading(false);
	}
});

function toLocalIsoString(date: Date): string {
	// datetime-local expects YYYY-MM-DDThh:mm
	const offset = date.getTimezoneOffset() * 60000;
	const localIso = new Date(date.getTime() - offset).toISOString().slice(0, 16);
	return localIso;
}

function showLoading(show: boolean) {
	loadingOverlay.style.display = show ? "flex" : "none";
}

function showStatus(msg: string, type: "success" | "error") {
	statusDiv.textContent = msg;
	statusDiv.className = type;
	statusDiv.style.display = "block";
}

function hideStatus() {
	statusDiv.style.display = "none";
}
