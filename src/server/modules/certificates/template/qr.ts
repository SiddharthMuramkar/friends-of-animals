import { renderSVG } from "uqr";
export const qrSvg = (url: string) => renderSVG(url, { ecc: "M", border: 4 });
