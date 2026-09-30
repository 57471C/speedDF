/**
 * Signature-pad uploads: PNG (keep alpha), GIF frame 0, JPEG/WebP → PNG data URL.
 * PDF and SVG are rejected. Stored stamps stay on the existing dataUrl fields.
 */

export const SIGNATURE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const SIGNATURE_UPLOAD_MAX_EDGE = 800;
export const SIGNATURE_UPLOAD_ACCEPT =
	".png,.gif,.jpg,.jpeg,.webp,image/png,image/gif,image/jpeg,image/webp";

type DecodedFrame = {
	source: CanvasImageSource;
	width: number;
	height: number;
	close: () => void;
};

/** Longest side capped at maxEdge. Smaller images stay their own size. */
export function fittedEdge(
	width: number,
	height: number,
	maxEdge = SIGNATURE_UPLOAD_MAX_EDGE,
): { width: number; height: number } {
	const w = Math.max(1, Math.round(width) || 1);
	const h = Math.max(1, Math.round(height) || 1);
	const edge = Math.max(w, h);
	if (edge <= maxEdge) return { width: w, height: h };
	const scale = maxEdge / edge;
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale)),
	};
}

/** Null when the file may be decoded. Message when the picker should stop. */
export function signatureUploadError(file: {
	name?: string;
	type?: string;
	size: number;
}): string | null {
	if (file.size > SIGNATURE_UPLOAD_MAX_BYTES) {
		return "Image must be 2MB or smaller.";
	}
	if (!acceptedSignatureFile(file)) {
		return "Use a PNG, GIF, JPEG, or WebP image.";
	}
	if (file.size <= 0) return "Could not read that image.";
	return null;
}

function acceptedSignatureFile(file: { name?: string; type?: string }): boolean {
	const type = (file.type || "").toLowerCase().split(";")[0].trim();
	const name = (file.name || "").toLowerCase();
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
	if (
		type === "image/svg+xml" ||
		type === "application/pdf" ||
		ext === "svg" ||
		ext === "pdf"
	) {
		return false;
	}
	if (type === "image/png" || type === "image/x-png" || ext === "png") return true;
	if (type === "image/gif" || ext === "gif") return true;
	if (
		type === "image/jpeg" ||
		type === "image/jpg" ||
		type === "image/pjpeg" ||
		ext === "jpg" ||
		ext === "jpeg"
	) {
		return true;
	}
	if (type === "image/webp" || ext === "webp") return true;
	return false;
}

function dataUrlToBlob(dataUrl: string): Blob {
	const trimmed = dataUrl.trim();
	const comma = trimmed.indexOf(",");
	if (!trimmed.startsWith("data:") || comma < 0) {
		throw new Error("Could not read that image.");
	}
	const meta = trimmed.slice(5, comma);
	const payload = trimmed.slice(comma + 1);
	const mime = meta.split(";")[0] || "application/octet-stream";
	const bytes = /;base64/i.test(meta)
		? Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0))
		: new TextEncoder().encode(decodeURIComponent(payload));
	return new Blob([bytes], { type: mime });
}

/**
 * First frame only. createImageBitmap snapshots animated GIFs at frame 0
 * instead of the frame the <img> element happens to be showing.
 */
async function decodeFirstFrame(blob: Blob): Promise<DecodedFrame> {
	if (typeof createImageBitmap === "function") {
		try {
			let bitmap: ImageBitmap;
			try {
				bitmap = await createImageBitmap(blob, {
					imageOrientation: "from-image",
					premultiplyAlpha: "none",
				});
			} catch {
				bitmap = await createImageBitmap(blob);
			}
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				close: () => bitmap.close(),
			};
		} catch {
			/* Fall through to an HTML image. */
		}
	}
	const url = URL.createObjectURL(blob);
	const img = new Image();
	try {
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error("Could not read that image."));
			img.src = url;
		});
	} catch (err) {
		URL.revokeObjectURL(url);
		throw err;
	}
	return {
		source: img,
		width: img.naturalWidth || img.width,
		height: img.naturalHeight || img.height,
		close: () => URL.revokeObjectURL(url),
	};
}

async function rasterBlobToPngDataUrl(blob: Blob): Promise<string> {
	const frame = await decodeFirstFrame(blob);
	try {
		if (frame.width < 1 || frame.height < 1) {
			throw new Error("Could not read that image.");
		}
		const { width, height } = fittedEdge(frame.width, frame.height);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Could not read that image.");
		ctx.clearRect(0, 0, width, height);
		ctx.imageSmoothingEnabled = true;
		if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
		ctx.drawImage(frame.source, 0, 0, width, height);
		const url = canvas.toDataURL("image/png");
		if (!url.startsWith("data:image/png")) {
			throw new Error("Could not read that image.");
		}
		return url;
	} finally {
		frame.close();
	}
}

/** Validate, then PNG data URL. Alpha is left intact. GIF uses frame 0. */
export async function signatureFileToPngDataUrl(file: File): Promise<string> {
	const rejection = signatureUploadError(file);
	if (rejection) throw new Error(rejection);
	return rasterBlobToPngDataUrl(file);
}

/** Re-encode a non-PNG data URL so pdf-lib embedPng can take it. */
export async function dataUrlToPngDataUrl(dataUrl: string): Promise<string> {
	if (/^data:image\/png/i.test(dataUrl.trim())) return dataUrl;
	return rasterBlobToPngDataUrl(dataUrlToBlob(dataUrl));
}

/** Fit a data URL inside a pad. The pad bitmap stays transparent where the image is. */
export async function drawContainedImage(
	canvas: HTMLCanvasElement,
	dataUrl: string | null | undefined,
): Promise<void> {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	if (!dataUrl) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		return;
	}
	const frame = await decodeFirstFrame(dataUrlToBlob(dataUrl));
	try {
		if (frame.width < 1 || frame.height < 1) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
		const dw = frame.width * scale;
		const dh = frame.height * scale;
		ctx.drawImage(
			frame.source,
			(canvas.width - dw) / 2,
			(canvas.height - dh) / 2,
			dw,
			dh,
		);
	} finally {
		frame.close();
	}
}
