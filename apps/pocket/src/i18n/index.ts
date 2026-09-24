import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import enGB from './en-GB.json';

/**
 * Every sentence the app shows, in one catalogue (NFR-14). English (UK)
 * only for now; the keys are what the screens use, so a second language is
 * a second file.
 */
export const resources = { 'en-GB': { translation: enGB } } as const;

const i18next = createInstance();
void i18next.use(initReactI18next).init({
  resources,
  lng: 'en-GB',
  fallbackLng: 'en-GB',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18next;
