import browser, { type Runtime } from "webextension-polyfill";

export type ScrapedData = {
	title: string;
	description: string;
};

const listener = (
	// biome-ignore lint/suspicious/noExplicitAny: Message content is unknown
	message: any,
	_sender: Runtime.MessageSender,
	_sendResponse: (response?: unknown) => void,
) => {
	if (message && message.type === "SCRAPE_PAGE") {
		const data = scrapePage();
		return Promise.resolve(data);
	}
};

// Listen for messages from the popup
// biome-ignore lint/suspicious/noExplicitAny: webextension-polyfill types are strict
browser.runtime.onMessage.addListener(listener as any);

function scrapePage(): ScrapedData {
	let title = document.title;
	let description = "";

	// Try to get OpenGraph title if available, might be cleaner than document.title
	const ogTitle = document.querySelector('meta[property="og:title"]');
	if (ogTitle) {
		const content = ogTitle.getAttribute("content");
		if (content) title = content;
	}

	// Try to get description from meta tags
	const metaDesc = document.querySelector('meta[name="description"]');
	const ogDesc = document.querySelector('meta[property="og:description"]');

	if (ogDesc) {
		const content = ogDesc.getAttribute("content");
		if (content) description = content;
	} else if (metaDesc) {
		const content = metaDesc.getAttribute("content");
		if (content) description = content;
	}

	// Basic cleanup
	title = title.trim();
	description = description.trim();

	return {
		title,
		description,
	};
}
