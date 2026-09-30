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
	dll_path: string;
	cancelled: boolean;
	message: string;
};

export function previewIsOn(status: PreviewRegistration | null): boolean {
	return status?.explorer === "yes";
}

export function previewStatusLine(status: PreviewRegistration | null): string {
	if (!status) return "Checking Explorer and Outlook registration…";
	const dll = status.dll_path ? status.dll_path : "(none)";
	return `Explorer: ${status.explorer} · Outlook: ${status.outlook_clicktorun} · DLL: ${dll}`;
}

export function fetchPreviewRegistration(): Promise<PreviewRegistration> {
	return invoke<PreviewRegistration>("preview_registration_status");
}

/** Register or unregister. The helper shows one UAC prompt. Cancel leaves status unchanged. */
export function applyPreviewRegistration(
	action: "register" | "unregister",
): Promise<PreviewRegistration> {
	return invoke<PreviewRegistration>("preview_registration_apply", { action });
}
