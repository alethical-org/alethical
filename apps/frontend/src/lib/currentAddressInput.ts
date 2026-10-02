/** Browser autofill can set the field before React receives its change event.
 * Read the visible value at submission; native TextInput refs fall back to state.
 * Address parsing and country handling remain the lookup service's responsibility.
 */
export function currentAddressInput(field: unknown, fallback: string): string {
  if (field && typeof field === 'object' && 'value' in field && typeof field.value === 'string') {
    return field.value;
  }
  return fallback;
}
