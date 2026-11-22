// Stand-in for next/image under Vitest:
//   vi.mock("next/image", () => import("@/test/next-image"));
// Vite imports an image file as a URL string, not the StaticImageData
// (width, height, blur) that next/image requires, so photos render nothing.
export default function Image() {
  return null;
}

/** For the art components' server-built <img>: its alt text, no file. */
export function getImageProps({ alt }: { alt: string }) {
  return { props: { alt } };
}
