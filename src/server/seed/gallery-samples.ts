// Fixed synthetic fixture identifiers, safe for Playwright to import without loading server modules.
export const gallerySeedId = (n: number) =>
  `01938a00-0000-7000-8000-000000103${String(n).padStart(3, "0")}`;
const auctionAsset = (n: number) =>
  `01938a00-0000-7000-8000-000000131${String(70 + n).padStart(3, "0")}`;
export const SEED_GALLERY = {
  items: [
    gallerySeedId(1),
    gallerySeedId(2),
    gallerySeedId(3),
    gallerySeedId(4),
  ],
  originalFileIds: [
    auctionAsset(1),
    auctionAsset(2),
    gallerySeedId(103),
    gallerySeedId(104),
  ],
  featured: [gallerySeedId(1), gallerySeedId(2)],
  report: gallerySeedId(201),
} as const;
