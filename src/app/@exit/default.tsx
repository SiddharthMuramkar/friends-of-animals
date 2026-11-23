/**
 * The @exit slot holds page-level bars that must sit outside <main>, so a
 * sticky bar can stay on screen over the footer too (#52). Only
 * /safeguarding and its report form (#116) have one (the Quick exit bar);
 * every other route renders nothing, after a full load (here) or a
 * client-side navigation (page.tsx and [...catchAll]/page.tsx, which
 * replace the slot's last page).
 */
export default function Default() {
  return null;
}
