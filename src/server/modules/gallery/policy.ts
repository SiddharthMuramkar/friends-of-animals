import { anyOf, role, signedIn, signedOut, type Policy } from "../../access/domain/policy";
export const GALLERY_POLICY = {
  "gallery.curate": role("content_manager", "staff_admin", "super_admin"),
  "gallery.read_published": anyOf(signedIn, signedOut),
  "gallery.report": anyOf(signedIn, signedOut),
} satisfies Policy<string>;
