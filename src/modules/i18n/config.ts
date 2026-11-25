/**
 * i18n Configuration
 *
 * Configures i18next for internationalization support.
 * Features:
 * - English bundled as the fallback; every other language is its own lazily
 *   loaded chunk, fetched before first render (i18nReady) or on change
 * - Language detection from localStorage
 * - Fallback to English for missing translations
 * - Development mode warnings for missing keys
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation resources
import enCommon from '@/modules/i18n/locales/en/common.json';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import enAuth from '@/modules/i18n/locales/en/auth.json';
import enSidebar from '@/modules/i18n/locales/en/sidebar.json';
import enChat from '@/modules/i18n/locales/en/chat.json';
import enCodeEditor from '@/modules/i18n/locales/en/codeEditor.json';
// oxlint-disable-next-line importx/order
import enTasks from '@/modules/i18n/locales/en/tasks.json';
// oxlint-disable-next-line importx/order
import enGit from '@/modules/i18n/locales/en/git.json';

// Import supported languages configuration
import { languages } from '@/modules/i18n/languages';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

// The chosen language lives in auth.db so it follows the user between devices.
// It is read synchronously from the preference mirror because i18n has to be
// configured at module load, long before any request could resolve.
const getSavedLanguage = (): string => {
  const saved = readUserPreference<string | null>('userLanguage', null);
  // Validate that the saved language is supported
  if (saved && languages.some(lang => lang.value === saved)) {
    return saved;
  }
  return 'en';
};

// Initialize i18next
i18n
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // Only English ships in the main bundle, as the fallback for every key;
    // other languages are fetched on demand (see loadLanguageResources).
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        auth: enAuth,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
        tasks: enTasks,
        git: enGit,
      },
    },

    // Default language
    lng: 'en',

    // Fallback language when a translation is missing
    fallbackLng: 'en',

    // Enable debug mode in development (logs missing keys to console)
    debug: false,

    // Namespaces - load only what's needed
    ns: ['common', 'settings', 'auth', 'sidebar', 'chat', 'codeEditor', 'tasks', 'git'],
    defaultNS: 'common',

    // Key separator for nested keys (default: '.')
    keySeparator: '.',

    // Namespace separator (default: ':')
    nsSeparator: ':',

    // Save missing translations (disabled - requires manual review)
    saveMissing: false,

    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React-specific settings
    react: {
      useSuspense: true, // Use Suspense for lazy-loading
      bindI18n: 'languageChanged', // Re-render on language change
      bindI18nStore: false, // Don't re-render on resource changes
    },
  });

// One lazily loaded chunk per non-English language and namespace. English is
// excluded: it is imported above and must never wait on a request.
const localeLoaders = import.meta.glob<{ default: Record<string, unknown> }>([
  '/src/modules/i18n/locales/*/*.json',
  '!/src/modules/i18n/locales/en/*.json',
]);
const loadedLanguages = new Set<string>(['en']);
const languageLoads = new Map<string, Promise<void>>();

/**
 * Used by this module's language switch and by the i18n tests: fetches every
 * namespace of a language once and registers it with i18next. English and
 * unknown languages resolve at once; a failed fetch leaves English showing.
 */
export function loadLanguageResources(language: string): Promise<void> {
  if (loadedLanguages.has(language)) return Promise.resolve();
  let pending = languageLoads.get(language);
  if (!pending) {
    const prefix = `/src/modules/i18n/locales/${language}/`;
    pending = Promise.all(
      Object.entries(localeLoaders)
        .filter(([file]) => file.startsWith(prefix))
        .map(async ([file, load]) => {
          const namespace = file.slice(prefix.length, -'.json'.length);
          i18n.addResourceBundle(language, namespace, (await load()).default, true, true);
        }),
    ).then(() => {
      loadedLanguages.add(language);
    }, (error: unknown) => {
      languageLoads.delete(language);
      console.warn(`Could not load the ${language} translations`, error);
    });
    languageLoads.set(language, pending);
  }
  return pending;
}

// Every caller (the language selector, synced preferences) goes through
// changeLanguage, so it fetches the language first: switching never shows
// raw English for a moment while the chunk is on its way.
const changeLanguageWithResources = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = (async (language?: string, callback?: Parameters<typeof i18n.changeLanguage>[1]) => {
  if (language) await loadLanguageResources(language);
  return changeLanguageWithResources(language, callback);
}) as typeof i18n.changeLanguage;

/**
 * Used by main.tsx to hold the first render until the saved language is in
 * place; resolves (never rejects) so a failed fetch still renders in English.
 */
export const i18nReady: Promise<void> = (() => {
  const saved = getSavedLanguage();
  return saved === 'en' ? Promise.resolve() : i18n.changeLanguage(saved).then(() => undefined, () => undefined);
})();

// Save language preference when it changes
i18n.on('languageChanged', (lng: string) => {
  writeUserPreference('userLanguage', lng);
});

// A language chosen on another device arrives with the hydrated preferences,
// after i18n was already initialized with whatever the mirror held.
subscribeToUserPreferences(() => {
  const saved = readUserPreference<string | null>('userLanguage', null);
  if (saved && saved !== i18n.language && languages.some(lang => lang.value === saved)) {
    void i18n.changeLanguage(saved);
  }
});

export default i18n;
