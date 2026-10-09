import type { ActionKind, ElementRef } from '../core/types';

/** Name of the CDP binding (`Runtime.addBinding`) the probe reports through. */
export const BINDING_NAME = '__bugtrail';

/**
 * Message the in-page probe sends through the CDP binding for each user action.
 * Versioned so an old probe left in a page can't confuse a newer extension.
 *
 * Privacy: the probe never sends what the user typed, only which field.
 */
export interface ProbePayload {
  v: 1;
  time: number;
  kind: Exclude<ActionKind, 'navigate'>;
  url: string;
  target?: ElementRef;
  key?: string;
}
