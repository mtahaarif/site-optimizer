/**
 * What a site is built with.
 *
 * The audit's job is to report defects, and a check that cannot apply to the
 * technology under it produces noise rather than a finding — "PHP fatal error"
 * on a static site, a WordPress author convention on a Shopify store. Knowing
 * the platform lets the runner skip those honestly, with a reason, instead of
 * silently passing them or falsely failing them.
 */

export type PlatformId =
  // JavaScript frameworks and meta-frameworks
  | 'nextjs' | 'nuxt' | 'astro' | 'sveltekit' | 'remix' | 'gatsby' | 'docusaurus'
  | 'angular' | 'react' | 'vue'
  // Content management systems
  | 'wordpress' | 'drupal' | 'joomla' | 'ghost' | 'typo3' | 'craft'
  // Hosted site builders
  | 'wix' | 'squarespace' | 'webflow' | 'weebly' | 'framer' | 'blogger'
  // Commerce
  | 'shopify' | 'magento' | 'woocommerce' | 'bigcommerce' | 'prestashop' | 'salesforce-commerce'
  // Server frameworks
  | 'laravel' | 'django' | 'rails' | 'aspnet' | 'express'
  // Static site generators
  | 'hugo' | 'jekyll' | 'eleventy'
  | 'unknown';

/**
 * What kind of thing it is. Gating is usually about the family rather than the
 * exact product — "does this run PHP", "is this a drag-and-drop builder" —
 * so checks can target a kind and stay correct as new platforms are added.
 */
export type PlatformKind =
  | 'framework'      // Next.js, Nuxt, Astro — you control the output
  | 'cms'            // WordPress, Drupal — templated, self-hosted
  | 'ecommerce'      // Shopify, Magento
  | 'site-builder'   // Wix, Squarespace, Webflow — output is generated for you
  | 'ssg'            // Hugo, Jekyll
  | 'server'         // Laravel, Django, Rails
  | 'unknown';

/**
 * Cross-cutting properties that do not map to one id or kind.
 *
 * "Does this run PHP" is the question several checks actually care about, and
 * it is true of WordPress, Drupal, Joomla, Laravel and Magento alike — a list
 * that would otherwise have to be repeated at every call site and kept in sync
 * as platforms are added.
 */
export type PlatformTrait = 'php';

/** Anything a check may gate on. */
export type PlatformSelector = PlatformId | PlatformKind | PlatformTrait;

export interface PlatformMatch {
  id: PlatformId;
  label: string;
  kind: PlatformKind;
  /** 0..1 — how strongly the evidence identifies this platform specifically */
  confidence: number;
  /** human-readable, and auditable: every verdict says what it was based on */
  evidence: string[];
}

export interface PlatformFingerprint {
  id: PlatformId;
  label: string;
  kind: PlatformKind;
  confidence: number;
  evidence: string[];
  /**
   * Everything matched, strongest first. Stacks are real: WooCommerce runs on
   * WordPress, a Shopify theme can ship React, so the runner needs the whole
   * set rather than only the winner.
   */
  matches: PlatformMatch[];
  /** true when the platform runs PHP — the only gate several checks need */
  runsPhp: boolean;
}

export const UNKNOWN_PLATFORM: PlatformFingerprint = {
  id: 'unknown',
  label: 'Unknown',
  kind: 'unknown',
  confidence: 0,
  evidence: [],
  matches: [],
  runsPhp: false,
};

/** Platforms whose pages are executed by PHP. */
export const PHP_PLATFORMS: ReadonlySet<PlatformId> = new Set<PlatformId>([
  'wordpress', 'woocommerce', 'drupal', 'joomla', 'typo3', 'craft',
  'laravel', 'magento', 'prestashop',
]);
