import { invoke } from "@tauri-apps/api/core";

/**
 * Windows UI gate, same platform string pdf.js uses:
 * "Win…" on Windows, "Mac…" on macOS, "Linux…" on Linux.
 * userAgent covers a WebView that leaves platform blank.
 */
export function isWindowsPlatform(platform: string, userAgent: string): boolean {
	return platform.includes("Win") || userAgent.includes("Windows");
}

/** Live registration reported by speeddf-preview-register status. */
export type PreviewRegistration = {
	explorer: string;
	outlook_clicktorun: string;
	/** Explorer `.svg` shellex plus its Click-to-Run value. Missing means off. */
	svg: string;
	/** Explorer `.pdf` shellex plus its Click-to-Run value. Missing means off. */
	pdf: string;
	dll_path: string;
	cancelled: boolean;
	message: string;
};

export type PreviewAction =
	| "register"
	| "unregister"
	| "register-svg"
	| "unregister-svg"
	| "register-pdf"
	| "unregister-pdf";

export function previewIsOn(status: PreviewRegistration | null): boolean {
	return status?.explorer === "yes";
}

/** SVG preview is independent of the Markdown and PDF checkboxes. */
export function previewSvgOn(status: PreviewRegistration | null): boolean {
	return status?.svg === "yes";
}

/** PDF preview is independent of the Markdown and SVG checkboxes. */
export function previewPdfOn(status: PreviewRegistration | null): boolean {
	return status?.pdf === "yes";
}

export function previewStatusLine(status: PreviewRegistration | null): string {
	if (!status) return "Checking Explorer and Outlook registration…";
	const dll = status.dll_path ? status.dll_path : "(none)";
	const svg = status.svg === "yes" ? "yes" : "no";
	const pdf = status.pdf === "yes" ? "yes" : "no";
	return `Explorer: ${status.explorer} · Outlook: ${status.outlook_clicktorun} · svg=${svg} · pdf=${pdf} · DLL: ${dll}`;
}

export function fetchPreviewRegistration(): Promise<PreviewRegistration> {
	return invoke<PreviewRegistration>("preview_registration_status");
}

/** Register or unregister Markdown, SVG, or PDF. The helper shows one UAC prompt. */
export function applyPreviewRegistration(
	action: PreviewAction,
): Promise<PreviewRegistration> {
	return invoke<PreviewRegistration>("preview_registration_apply", { action });
}
