/**
 * This fork's own name. OpenCove's trademark policy (TRADEMARKS.md) asks a modified build to use a
 * distinct name and to say that it is not the official distribution. Only what people read changes;
 * code identifiers, the `opencove` CLI, package names and paths keep upstream's names so merges stay easy.
 */
export const PRODUCT_NAME = 'Session Desk'

export const UPSTREAM_NAME = 'OpenCove'

export const NOT_OFFICIAL_NOTE = `${PRODUCT_NAME} is based on ${UPSTREAM_NAME} and is not an official ${UPSTREAM_NAME} build.`

/** Names this fork wherever upstream's interface text names OpenCove (the lowercase CLI name stays). */
export function brandText(text: string): string {
  return text
    .replaceAll(`an ${UPSTREAM_NAME}`, `a ${PRODUCT_NAME}`)
    .replaceAll(UPSTREAM_NAME, PRODUCT_NAME)
}

/** The tab icon: two overlapping session cards above a desk. Inline, so the login page shows it before sign-in. */
export const FAVICON_DATA_URI =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%231d2533'/><rect x='6' y='6' width='13' height='9' rx='1.5' fill='%2363b3ff'/><rect x='14' y='12' width='12' height='8' rx='1.5' fill='%238fd6a8' stroke='%231d2533' stroke-width='1.2'/><rect x='5' y='23' width='22' height='3' rx='1.5' fill='%23e8eef6'/></svg>"
