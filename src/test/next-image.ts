// Stand-in for next/image under Vitest:
//   vi.mock("next/image", () => import("@/test/next-image"));
// Vite imports an image file as a URL string, not the StaticImageData
// (width, height, blur) that next/image requires, so photos render nothing.
export default function Image() {
  return null;
}

/**
 * getImageProps's stand-in (LcpPhoto): the props it passes through, with
 * no srcset, since that needs the image's width.
 */
export function getImageProps({
  src,
  alt,
  sizes,
  loading,
  fetchPriority,
  className,
  style,
}: {
  src: unknown;
  alt: string;
  sizes?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  className?: string;
  style?: Record<string, string>;
}) {
  return {
    props: {
      alt,
      loading,
      fetchPriority,
      className,
      style,
      sizes,
      src: typeof src === "string" ? src : undefined,
    },
  };
}
