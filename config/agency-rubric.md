# Agency web-dev judgment rubric

Filip (Olomouc, CZ, IČO subcontractor, 3.5 years) wants subcontract web-dev work from local agencies.
Agencies have lower, looser requirements than his strict job profile — judge leniently.

His strengths (two lines): AI-assisted/agentic development (coding agents, MCP, custom agents/skills, model
routing, visual verification); WordPress/WooCommerce (PHP, child themes, ACF), React/TypeScript/Vite/Tailwind,
Astro, Supabase/Netlify, deploys, client communication.

## What counts as an open web-dev position

- `devPositionOpen` is true ONLY with an explicit, current call to join/develop: a role title plus a hiring
  verb ("hledáme", "přidej se", "volná pozice", "nabízíme pozici") in the fetched text.
- Web-dev roles: frontend, backend, full-stack, WordPress/WooCommerce, Shoptet, PHP, React, mobile-app
  development for the agency itself. Marketing, copywriting, PPC, sales, HR, graphic-only roles are NOT web-dev.
- Closed or filled positions ("obsazena", "obsazeno", "pozice je plná", dead ad, 404 page) are NOT open.
- Generic "spolupracujeme s freelancery" with no open call is NOT open.
- When several web-dev roles are open, pick the best match for a WordPress/React stack (WordPress developer
  over React Native; medior over principal) — exactly one, with its own quote and URL.
- When in doubt, `devPositionOpen` is false.

## Fields

- `positionTitle`: the role title as written on the page, or null when none is open.
- `positionUrl`: MUST be one of the fetched page URLs (the careers page or the job-detail page carrying
  the quote). Never invent or shorten a URL.
- `evidenceQuote`: a VERBATIM substring of the fetched page text (character-for-character) proving the
  open role — the hiring sentence for THAT role (it names the title, or it sits on the role's own
  detail page). A generic "join us" banner is not a quote for a specific role. Empty string when nothing is open.
- `form`: `ico` (IČO/živnost/OSVČ/externí spolupráce/subdodávka), `hpp` (pracovní poměr/plný úvazek with no
  IČO mention), `both` (both offered), `unknown` (unstated).
- `devRate`: pay for the DEVELOPER as stated on the page (e.g. "600 Kč/h", "od 40 000 Kč"). Null when
  unstated. NEVER a client price list (ceník: what the agency charges its clients for hours, projects or
  packages) — client prices are irrelevant and must never appear here.
- `remoteOrOlomouc`: true when the role allows remote work or is located in Olomouc (or surroundings).
- `fit` 0–10 (lenient): web dev + stated developer rate + remote/Olomouc = excellent; IČO is a plus,
  never a gate. HPP-only is fine, just scores lower than IČO-able.
- `reason`: one Czech sentence: what the role is and why it fits or not.

Reply with ONLY the JSON object, no other text.
