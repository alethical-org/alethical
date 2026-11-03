import type { FormEvent, ReactNode } from 'react';

import { Refs } from './Refs';

export interface FormSpec {
  title: string;
  lead: string;
  noteLabel: string;
  submit: string;
  busy: string;
  src: boolean;
  name: boolean;
  recs: 'name' | 'split' | null;
  pick: boolean;
  /** The other name the evidence must say more than (confirm, create, merge). */
  beyond: string | null;
}

export interface FormErrors {
  note?: string;
  src?: string;
  pick?: string;
  recs?: string;
  name?: string;
}

export interface CheckOption {
  key: string;
  title: string;
  meta: string;
  checked: boolean;
  toggle: () => void;
}

export interface ChipOption {
  label: string;
  selected: boolean;
  pick: () => void;
}

/**
 * The identity form (Confirm identities drawing, `formOpen`): name, records or roles,
 * the record to merge in with its preview, the evidence note and its source, then
 * the action and Cancel. The parent owns the entries and the save.
 */
export function IdentityForm({
  spec,
  errors,
  newNameLabel,
  newName,
  onNewName,
  recsLegend,
  periodChips,
  recOptions,
  recsCount,
  recsPager,
  roleOptions,
  staleNotice,
  pickOptions,
  pickPager,
  mergePreview,
  note,
  onNote,
  src,
  onSrc,
  saving,
  onSubmit,
  onCancel,
}: {
  spec: FormSpec;
  errors: FormErrors;
  newNameLabel: string;
  newName: string;
  onNewName: (value: string) => void;
  recsLegend: string;
  periodChips: ChipOption[];
  recOptions: CheckOption[];
  recsCount: string;
  recsPager: ReactNode;
  roleOptions: CheckOption[];
  staleNotice: ReactNode;
  pickOptions: Array<{ key: string; label: string; checked: boolean; choose: () => void }>;
  pickPager: ReactNode;
  mergePreview: ReactNode;
  note: string;
  onNote: (value: string) => void;
  src: string;
  onSrc: (value: string) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    // Only the form's own submit button saves; a page button inside it (the shared
    // pager's Previous and Next carry no type) must never send the form.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter && submitter.getAttribute('type') !== 'submit') return;
    onSubmit();
  }
  return (
    <form
      id="identity-form"
      className="ci-form"
      noValidate
      onSubmit={submit}
      aria-labelledby="form-h"
    >
      <div className="ci-form-head">
        <h3 id="form-h">
          <Refs>{spec.title}</Refs>
        </h3>
        <p>
          <Refs>{spec.lead}</Refs>
        </p>
      </div>
      {spec.name && (
        <label className="ci-field">
          <span className="ci-field-label">{newNameLabel}</span>
          <input
            type="text"
            className="ci-input"
            value={newName}
            onChange={(event) => onNewName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            autoComplete="off"
          />
          {errors.name && <span className="ci-field-error">{errors.name}</span>}
        </label>
      )}
      {spec.recs && (
        <fieldset className="ci-fieldset">
          <legend className="ci-field-label">{recsLegend}</legend>
          {periodChips.length > 0 && (
            <div role="group" aria-label="Select by period" className="ci-chips">
              {periodChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="ci-chip f-num"
                  aria-pressed={chip.selected}
                  onClick={chip.pick}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          {recOptions.map((option) => (
            <label
              key={option.key}
              className="ci-option"
              data-checked={option.checked || undefined}
            >
              <input type="checkbox" checked={option.checked} onChange={option.toggle} />
              <span className="ci-option-text">
                <span className="ci-option-title">{option.title}</span>
                <span className="ci-option-meta f-num">{option.meta}</span>
              </span>
            </label>
          ))}
          {recsPager}
          <span className="ci-muted ci-small f-num">{recsCount}</span>
          {roleOptions.length > 0 && (
            <fieldset className="ci-roles">
              <legend>Roles that move to the new record</legend>
              <p>
                Each confirmed role goes to exactly one record. Unchecked roles stay with the
                current record.
              </p>
              {roleOptions.map((option) => (
                <label key={option.key} className="ci-role">
                  <input type="checkbox" checked={option.checked} onChange={option.toggle} />
                  {option.title}
                </label>
              ))}
            </fieldset>
          )}
          {staleNotice}
          {errors.recs && <span className="ci-field-error">{errors.recs}</span>}
        </fieldset>
      )}
      {spec.pick && (
        <fieldset className="ci-fieldset ci-pick">
          <legend className="ci-field-label">Record to merge in</legend>
          {pickOptions.map((option) => (
            <label key={option.key} className="ci-radio">
              <input
                type="radio"
                name="merge-pick"
                checked={option.checked}
                onChange={option.choose}
              />
              <span className="f-num">
                <Refs>{option.label}</Refs>
              </span>
            </label>
          ))}
          {pickPager}
          {errors.pick && <span className="ci-field-error">{errors.pick}</span>}
        </fieldset>
      )}
      {mergePreview}
      <label className="ci-field">
        <span className="ci-field-label">{spec.noteLabel}</span>
        <span id="note-hint" className="ci-hint">
          Every Alethical Finance account can read this note
        </span>
        <textarea
          className="ci-input ci-textarea"
          rows={3}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby="note-hint"
        />
        {errors.note && <span className="ci-field-error">{errors.note}</span>}
      </label>
      {spec.src && (
        <label className="ci-field">
          <span className="ci-field-label">Source</span>
          <span id="src-hint" className="ci-hint">
            A record number, file name or web address
          </span>
          <input
            type="text"
            className="ci-input"
            value={src}
            onChange={(event) => onSrc(event.target.value)}
            aria-invalid={errors.src ? true : undefined}
            aria-describedby="src-hint"
            autoComplete="off"
          />
          {errors.src && <span className="ci-field-error">{errors.src}</span>}
        </label>
      )}
      <div className="ci-form-actions">
        <button type="submit" className="f-btn ci-submit" aria-disabled={saving || undefined}>
          {saving && <span className="ci-spinner" aria-hidden="true" />}
          {saving ? spec.busy : spec.submit}
        </button>
        <button type="button" className="f-btn f-btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
