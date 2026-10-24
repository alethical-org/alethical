import { useLayoutEffect, useState, type RefObject } from 'react';
import { Platform } from 'react-native';

/** Observe browser-filled text without treating it as a request to search. */
export function useAddressInputValue(
  field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  fallback: string,
) {
  const [actual, setActual] = useState(fallback);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = field.current;
    if (!element) return;
    const read = () => setActual(element.value);
    read();
    element.addEventListener('input', read);
    element.addEventListener('change', read);
    element.addEventListener('focus', read);
    window.addEventListener('pageshow', read);
    // Some browser/password-manager fills change only the value property.
    const timer = setInterval(read, 500);
    return () => {
      clearInterval(timer);
      element.removeEventListener('input', read);
      element.removeEventListener('change', read);
      element.removeEventListener('focus', read);
      window.removeEventListener('pageshow', read);
    };
  }, [field, fallback]);
  return Platform.OS === 'web' ? actual : fallback;
}
