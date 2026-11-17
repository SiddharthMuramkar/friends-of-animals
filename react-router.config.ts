import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Vercel: no preset on purpose. @vercel/react-router (vercelPreset) does not
  // support React Router 8 yet; Vercel's builder deploys build/server/index.js
  // as a single Node function without it. See docs/deploy-vercel-notes.md.
} satisfies Config;
