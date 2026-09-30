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
	/** Explorer `.svg` shellex. Missing from an older helper means off. */
	svg: string;
	dll_path: string;
	cancelled: boolean;
	message: string;
};

export type PreviewAction = "register" | "unregister" | "register-svg" | "unregister-svg";

export function previewIsOn(status: PreviewRegistration | null): boolean {
	return status?.explorer === "yes";
}

/** SVG preview is independent of the Markdown checkbox. */
export function previewSvgOn(status: PreviewRegistration | null): boolean {
	return status?.svg === "yes";
}

export function previewStatusLine(status: PreviewRegistration | null): string {
	if (!status) return "Checking Explorer and Outlook registration…";
	const dll = status.dll_path ? status.dll_path : "(none)";
	const svg = status.svg === "yes" ? "yes" : "no";
	return `Explorer: ${status.explorer} · Outlook: ${status.outlook_clicktorun} · svg=${svg} · DLL: ${dll}`;
}

export function fetchPreviewRegistration(): Promise<PreviewRegistration> {
	return invoke<PreviewRegistration>("preview_registration_status");
}

/** Register or unregister Markdown, or the separate SVG shellex. The helper shows one UAC prompt. */
export function applyPreviewRegistration(
	action: PreviewAction,
): Promise<PreviewRegistration> {
	return invoke<PreviewRegistration>("preview_registration_apply", { action });
}
