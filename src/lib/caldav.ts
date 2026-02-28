import type { CalDavSettings } from "./storage";

export interface CalendarEvent {
	title: string;
	start: string; // ISO string
	end: string; // ISO string
	description?: string;
	url?: string;
}

export class CalDavClient {
	private settings: CalDavSettings;
	private authHeader: string;

	constructor(settings: CalDavSettings) {
		this.settings = settings;
		// Basic Auth header generation with UTF-8 support
		const credentials = `${settings.username}:${settings.password}`;
		const encoded = new TextEncoder().encode(credentials);
		const binary = String.fromCharCode(...encoded);
		this.authHeader = `Basic ${btoa(binary)}`;
	}

	/**
	 * Validates the connection to the CalDAV server.
	 * It performs a PROPFIND request to the server URL.
	 */
	async checkConnection(): Promise<boolean> {
		try {
			const response = await fetch(this.settings.serverUrl, {
				method: "PROPFIND",
				headers: {
					Authorization: this.authHeader,
					Depth: "0",
					"Content-Type": "application/xml; charset=utf-8",
				},
				// Basic body to request resource type
				body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
			});

			// 200 OK or 207 Multi-Status are successful responses for WebDAV
			return response.ok;
		} catch (error) {
			console.error("CalDAV connection check failed:", error);
			return false;
		}
	}

	/**
	 * Creates a new event on the CalDAV server.
	 */
	async createEvent(event: CalendarEvent): Promise<void> {
		const uid = this.generateUid();
		const icsContent = this.generateIcs(event, uid);
		const filename = `${uid}.ics`;

		// Ensure URL ends with /
		const baseUrl = this.settings.serverUrl.endsWith("/")
			? this.settings.serverUrl
			: `${this.settings.serverUrl}/`;

		const targetUrl = `${baseUrl}${filename}`;

		const response = await fetch(targetUrl, {
			method: "PUT",
			headers: {
				Authorization: this.authHeader,
				"Content-Type": "text/calendar; charset=utf-8",
				"If-None-Match": "*", // Prevent overwriting existing resource (unlikely with UUID)
			},
			body: icsContent,
		});

		if (!response.ok && response.status !== 201 && response.status !== 204) {
			throw new Error(
				`Failed to create event: ${response.status} ${response.statusText}`,
			);
		}
	}

	private generateUid(): string {
		return crypto.randomUUID();
	}

	private formatDate(dateStr: string): string {
		// Convert ISO string to iCalendar format: YYYYMMDDTHHMMSSZ
		const date = new Date(dateStr);
		// Ensure we are using UTC
		return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
	}

	private generateIcs(event: CalendarEvent, uid: string): string {
		const dtStamp = this.formatDate(new Date().toISOString());
		const dtStart = this.formatDate(event.start);
		const dtEnd = this.formatDate(event.end);

		// Escape special characters in text fields (comma, semicolon, backslash, newline)
		const escapeText = (str: string) =>
			str.replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\n/g, "\\n");

		const summary = escapeText(event.title);
		const description = event.description ? escapeText(event.description) : "";

		const lines = [
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//SendToCal//EN",
			"BEGIN:VEVENT",
			`UID:${uid}`,
			`DTSTAMP:${dtStamp}`,
			`DTSTART:${dtStart}`,
			`DTEND:${dtEnd}`,
			`SUMMARY:${summary}`,
		];
		if (description) {
			lines.push(`DESCRIPTION:${description}`);
		}
		if (event.url) {
			lines.push(`URL:${event.url}`);
		}
		lines.push("END:VEVENT", "END:VCALENDAR");

		return lines.join("\n");
	}
}
