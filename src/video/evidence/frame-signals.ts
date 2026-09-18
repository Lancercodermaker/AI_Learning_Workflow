import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

export type FrameSignals = { visual_change: number; ocr_change: number; semantic_boundary: number };

async function normalizedImage(image: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const result = await sharp(image)
    .resize(320, 180, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: result.data, width: result.info.width, height: result.info.height };
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function normalizedTokenDifference(previous: string, current: string): number {
  const previousTokens = tokenSet(previous);
  const currentTokens = tokenSet(current);
  const union = new Set([...previousTokens, ...currentTokens]);
  if (union.size === 0) return 0;
  let changed = 0;
  for (const token of union) {
    if (previousTokens.has(token) !== currentTokens.has(token)) changed += 1;
  }
  return changed / union.size;
}

export async function scoreFrameSignals(
  previousImage: Buffer,
  currentImage: Buffer,
  previousOcr: string,
  currentOcr: string,
  semanticBoundary: number,
): Promise<FrameSignals> {
  const previous = await normalizedImage(previousImage);
  const current = await normalizedImage(currentImage);
  const width = Math.min(previous.width, current.width);
  const height = Math.min(previous.height, current.height);
  const diff = Buffer.alloc(width * height * 3);
  const visualPixels = pixelmatch(previous.data, current.data, diff, width, height, { threshold: 0.1 });
  return {
    visual_change: visualPixels / (width * height),
    ocr_change: normalizedTokenDifference(previousOcr, currentOcr),
    semantic_boundary: Math.min(1, Math.max(0, semanticBoundary)),
  };
}
