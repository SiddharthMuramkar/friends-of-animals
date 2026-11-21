// Where leaving a draft preview goes: back to the public page that was
// being previewed, never to an address the form was given.

export function previewExitPath(_raw: string | null): `/${string}` {
  return "/";
}
