/**
 * Every button/select/modal custom_id in this bot follows:
 *   "<namespace>:<action>:<dealId>[:extra]"
 * A single InteractionRouter parses this and dispatches to the handler
 * registered for `${namespace}:${action}`. Fund/state-mutating actions are
 * additionally wrapped so the FIRST click renders a confirmation prompt
 * whose own custom_id is "<namespace>:confirm:<action>:<dealId>" /
 * "<namespace>:cancel:<action>:<dealId>" — only the confirm handler ever
 * invokes a use case. See withConfirmation().
 */
export interface DecodedCustomId {
  namespace: string;
  action: string;
  dealId: string;
  extra: string | null;
}

const DELIMITER = ':';

export function encodeCustomId(namespace: string, action: string, dealId: string, extra?: string): string {
  const parts = [namespace, action, dealId, ...(extra ? [extra] : [])];
  const id = parts.join(DELIMITER);
  if (id.length > 100) {
    throw new Error(`custom_id exceeds Discord's 100-character limit: "${id}" (${id.length} chars)`);
  }
  return id;
}

export function decodeCustomId(customId: string): DecodedCustomId {
  const [namespace, action, dealId, ...rest] = customId.split(DELIMITER);
  if (!namespace || !action || !dealId) {
    throw new Error(`Malformed custom_id: "${customId}"`);
  }
  return { namespace, action, dealId, extra: rest.length > 0 ? rest.join(DELIMITER) : null };
}

// NOTE: the "confirm_"/"cancel_" prefix below is joined with an underscore,
// NOT the ':' delimiter — action is one single field in the encoded string,
// and if it itself contained a ':' (e.g. "confirm:freeze"), splitting the
// whole custom_id on ':' would shift every subsequent field (dealId, extra)
// by one, silently corrupting them. Underscore-joining keeps "confirm_freeze"
// as a single unambiguous field.
export function encodeConfirm(namespace: string, action: string, dealId: string, extra?: string): string {
  return encodeCustomId(namespace, `confirm_${action}`, dealId, extra);
}

export function encodeCancel(namespace: string, action: string, dealId: string, extra?: string): string {
  return encodeCustomId(namespace, `cancel_${action}`, dealId, extra);
}
