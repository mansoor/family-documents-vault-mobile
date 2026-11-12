import { categoryLabel, shortTypeLabel, type DocumentTypeView, type Member } from '@fdv/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipLine, PickerSheet, type PickOption } from '../ui/picker';
import { HOUSEHOLD } from './draft';
import { matchTypes, rankTypes } from './types';

/** "Nobody's", as a value a chip can carry. */
const NOBODY = '-';

/** A person's first letter, for their chip. */
const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/**
 * What it is (R2): the kinds filed most on one line, then ⋯ for every kind
 * the household offers, found by words and grouped as the web groups them.
 * On the capture card and in Edit details alike.
 */
export function KindChooser(props: {
  types: readonly DocumentTypeView[];
  /** What the household filed lately, for the order on the line. */
  filed?: readonly (string | null | undefined)[];
  chosen: string | null;
  onChoose: (key: string | null) => void;
  label: string;
  ids: { more: string; find: string; picker: string; chip?: string };
}) {
  const [open, setOpen] = useState(false);
  const ranked = rankTypes(props.types, props.filed ?? []);
  const line: PickOption[] = ranked.top.map((ty) => ({ value: ty.key, label: ty.label, short: shortTypeLabel(ty) }));
  const chosenType = props.types.find((ty) => ty.key === props.chosen);
  if (chosenType && !line.some((o) => o.value === chosenType.key)) {
    line.unshift({ value: chosenType.key, label: chosenType.label, short: shortTypeLabel(chosenType) });
  }
  const all: PickOption[] = matchTypes(props.types, '')
    .map((ty) => ({ value: ty.key, label: ty.label, group: categoryLabel(ty.category) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  const chosen = props.chosen ? [props.chosen] : [];
  return (
    <>
      <ChipLine
        label={props.label}
        options={line}
        chosen={chosen}
        onToggle={(k) => props.onChoose(props.chosen === k ? null : k)}
        onMore={() => setOpen(true)}
        moreID={props.ids.more}
        expanded={open}
        {...(props.ids.chip ? { chipID: props.ids.chip } : {})}
      />
      <PickerSheet
        visible={open}
        title={props.label}
        options={all}
        chosen={chosen}
        onDone={([k]) => {
          setOpen(false);
          if (k) props.onChoose(k);
        }}
        onClose={() => setOpen(false)}
        testID={props.ids.picker}
        findID={props.ids.find}
        optionID={`${props.ids.picker}-kind`}
      />
    </>
  );
}

/**
 * Whose it is (R2): the person on the line first (the one filing it), then
 * ⋯ for the rest of the family, The household (where the vault keeps it,
 * 0.9.0-dev.32) and Not sure yet. A teen files only their own, so the line
 * is shown and not changed.
 */
export function OwnerChooser(props: {
  members: readonly Pick<Member, 'id' | 'display_name'>[];
  me: string | null;
  teen: boolean;
  chosen: string | null;
  /** The household's: shown chosen, with no person. */
  household?: boolean;
  /** The vault keeps The household as whose a document is: offered. */
  householdOn?: boolean;
  /** A person's id, HOUSEHOLD, or null for Not sure yet. */
  onChoose: (id: string | null) => void;
  label: string;
  ids: { more: string; picker: string; chip?: string };
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const people = props.members.filter((m) => !props.teen || m.id === props.me);
  const mine = (m: Pick<Member, 'id' | 'display_name'>) => (m.id === props.me ? `${m.display_name} (${t('capture.yours')})` : m.display_name);
  const options: PickOption[] = [
    ...[...people]
      .sort((a, b) => Number(b.id === props.me) - Number(a.id === props.me))
      .map((m) => ({ value: m.id, label: mine(m), leading: initial(m.display_name) })),
    ...(props.teen || !props.householdOn ? [] : [{ value: HOUSEHOLD, label: t('capture.household') }]),
    ...(props.teen ? [] : [{ value: NOBODY, label: t('capture.nobody') }]),
  ];
  const chosen = [props.household ? HOUSEHOLD : (props.chosen ?? NOBODY)];
  const choose = (v: string) => props.onChoose(v === NOBODY ? null : v);
  return (
    <>
      <ChipLine
        label={props.label}
        options={options}
        chosen={chosen}
        onToggle={(v) => choose(chosen.includes(v) && v !== NOBODY ? NOBODY : v)}
        onMore={() => setOpen(true)}
        moreID={props.ids.more}
        expanded={open}
        disabled={props.teen}
        {...(props.ids.chip ? { chipID: props.ids.chip } : {})}
      />
      <PickerSheet
        visible={open}
        title={props.label}
        options={options}
        chosen={chosen}
        onDone={([v]) => {
          setOpen(false);
          if (v) choose(v);
        }}
        onClose={() => setOpen(false)}
        testID={props.ids.picker}
        optionID={`${props.ids.picker}-owner`}
      />
    </>
  );
}
