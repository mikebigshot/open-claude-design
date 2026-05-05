import { tokens } from '@open-design/design-tokens';

/**
 * styled-components theme — derived from the shared design tokens package
 * so the iframe runtime and the host app cannot drift.
 */
export const theme = tokens;

export type Theme = typeof theme;
