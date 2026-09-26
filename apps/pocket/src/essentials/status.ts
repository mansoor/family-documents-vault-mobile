import {
  deriveStatus,
  localToday,
  missingFields,
  type DocumentTypeView,
  type DocumentView,
  type RequiredRules,
  type Status,
  type StatusInput,
} from '@fdv/shared';

/**
 * A type as it is kept with the copies, for today's status: since 0.2.1
 * with what it requires (`core`, `fields`), so a kept passport with no
 * number reads Needs info here as it does in the vault. A type kept by
 * 0.2.0 has neither.
 */
export type StatusType = NonNullable<StatusInput['type']> & Pick<RequiredRules, 'core' | 'fields'>;

/** What is kept of a type from GET /document-types: as much as its status needs. */
export function keptType(t: DocumentTypeView): StatusType {
  return {
    key: t.key,
    expiry_driver: t.expiry_driver,
    reminder_leads: t.reminder_leads,
    ...(t.core ? { core: t.core } : {}),
    fields: t.fields.map((f) => ({ key: f.key, label: f.label, ...(f.required ? { required: true } : {}) })),
  };
}

/**
 * Today's status on the phone, from the kept types; the vault's own word
 * when they are not known.
 *
 * A kept copy's details cannot change without a connection: only the day
 * does. So a document whose details are here, with its type's rules kept,
 * is worked out as the vault works it out (`missingFields`, then
 * deriveStatus), in the same words. An Only me document's details are
 * sealed and not in the set (0.5.8), and a type kept by 0.2.0 has no rules:
 * for those the vault's Needs info stands, as it was worked out while the
 * details were open, unless the expiry has since made it Expired or
 * Expiring, which come first.
 */
export function statusToday(doc: DocumentView, types: readonly StatusType[], today: string): Status | null {
  const type = types.find((x) => x.key === doc.type_key) ?? null;
  if (doc.type_key && !type) return doc.status ?? null;
  const known = type === null || (type.fields != null && doc.visibility !== 'private');
  const missing = type && known ? missingFields(type, doc) : null;
  const now = deriveStatus(
    {
      type: type && { key: type.key, expiry_driver: type.expiry_driver, reminder_leads: type.reminder_leads },
      owner_member_id: doc.owner_member_id,
      expires: doc.expires,
      ...(missing ? { missing } : {}),
    },
    today,
  );
  if (!known && doc.status?.value === 'needs_info' && now.value !== 'expired' && now.value !== 'expiring_soon') {
    return doc.status;
  }
  return now;
}

/** Today's status where the phone is; the vault's own word when the phone cannot say. */
export function statusHere(doc: DocumentView, types: readonly StatusType[]): Status | null {
  try {
    return statusToday(doc, types, localToday(Intl.DateTimeFormat().resolvedOptions().timeZone));
  } catch {
    return doc.status ?? null;
  }
}
