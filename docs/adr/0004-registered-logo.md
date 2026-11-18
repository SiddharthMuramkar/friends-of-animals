# ADR-0004: The registered logo is traced and used unchanged

- Status: Accepted
- Date: 2026-11-17

## Context

FOA's logo is a registered mark. The only source in the repo was a small screenshot. A vector was traced from it and checked against that screenshot.

Evidence: `public/brand/README.md`, `public/brand/foa-logo.svg`, merged pull request #16, closed issue #9.

## Decision

`public/brand/foa-logo.svg` is the master. Every other logo file is made by scaling that file (`npm run brand:assets`). The site header, favicon, and social preview use these files. Do not redraw, recolour, re-font, crop, or rearrange the mark.

In dark mode the header puts the logo on a white plate, because a single-colour version has not been approved.

## Consequences

- Agents do not edit the logo geometry to suit a layout.
- Two questions are still open in issue #17: whether the three tiles may appear without the wordmark at tiny sizes, and whether a single-colour version is allowed. Until FOA answers, neither of those files exists.
- If FOA supplies the original artwork file, it replaces the trace. That has not happened.
