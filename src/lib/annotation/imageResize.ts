/**
 * Pure math + canvas helpers for image document resize (PowerToys-style).
 * Aspect-locked W / H / Scale% stay in sync; apply resamples pixels.
 */

export type ImageResizeField = "width" | "height" | "scale";

export type ImageResizeState = {
	width: number;
	height: number;
	/** Percent of native size (width basis when aspect may differ). */
	scale: number;
};

export type ImageResizeNative = {
	nativeWidth: number;
	nativeHeight: number;
};

const MIN_PX = 1;
const MAX_PX = 20000;

export function clampPx(n: number): number {
	if (!Number.isFinite(n)) return MIN_PX;
	return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(n)));
}

/**
 * Scale % for the image resize strip: whole numbers from 1–99 only
 * (downscale presets / typed values; 100% is native via W/H display).
 */
export function clampScale(n: number): number {
	if (!Number.isFinite(n)) return 99;
	return Math.min(99, Math.max(1, Math.round(n)));
}

/** Common scale presets for the resize strip dropdown. */
export const SCALE_PRESETS = [75, 50, 25] as const;

/**
 * Derive linked width / height / scale after editing one field.
 * When aspect is locked, the other dimension tracks the native ratio.
 * Scale is always (width / nativeWidth) * 100.
 */
export function computeLinkedResize(
	field: ImageResizeField,
	value: number,
	lockAspect: boolean,
	native: ImageResizeNative,
	current: ImageResizeState,
): ImageResizeState {
	const nw = Math.max(1, native.nativeWidth);
	const nh = Math.max(1, native.nativeHeight);
	const aspect = nw / nh;

	if (field === "width") {
		const width = clampPx(value);
		let height = current.height;
		if (lockAspect) {
			height = clampPx(width / aspect);
		}
		// Display scale may exceed 99 when enlarging via px; UI clamps only on scale edit
		const scale = Math.round((width / nw) * 100 * 100) / 100;
		return { width, height, scale };
	}

	if (field === "height") {
		const height = clampPx(value);
		let width = current.width;
		if (lockAspect) {
			width = clampPx(height * aspect);
		}
		const scale = Math.round((width / nw) * 100 * 100) / 100;
		return { width, height, scale };
	}

	// scale — 1–99% of native only
	const scale = clampScale(value);
	const width = clampPx((nw * scale) / 100);
	const height = lockAspect
		? clampPx((nh * scale) / 100)
		: clampPx(current.height * (width / Math.max(1, current.width)));
	return { width, height, scale };
}

export function mimeFromFileName(fileName: string | null | undefined): string {
	const lower = (fileName || "").toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".bmp")) return "image/bmp";
	return "image/jpeg";
}

/**
 * Resample an image URL to target pixel size. Returns encoded bytes.
 * JPEG quality 0.92 when encoding JPEG; PNG is lossless.
 */
export async function resampleImageToBytes(
	sourceUrl: string,
	targetWidth: number,
	targetHeight: number,
	mime: string,
): Promise<Uint8Array | null> {
	const w = clampPx(targetWidth);
	const h = clampPx(targetHeight);
	const img = new Image();
	try {
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error("Failed to load image for resize"));
			img.src = sourceUrl;
		});
	} catch {
		return null;
	}

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, 0, 0, w, h);

	const useJpeg = mime === "image/jpeg" || mime === "image/jpg";
	const exportMime = useJpeg ? "image/jpeg" : mime === "image/webp" ? "image/webp" : "image/png";
	const quality = useJpeg ? 0.92 : undefined;

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob((b) => resolve(b), exportMime, quality);
	});
	if (!blob) return null;

	const buffer = await blob.arrayBuffer();
	return new Uint8Array(buffer);
}
