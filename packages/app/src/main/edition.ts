/**
 * What this build calls itself, and where it points people.
 *
 * The About panel reads this and renders whatever it finds.
 *
 * Keep the shape in step with the file this replaces during the
 * export: a field added there must be added here too, or the build
 * stops compiling.
 */

/** A link shown in the About panel. `labelKey` is an i18n key. */
export interface EditionLink {
  labelKey: string;
  url: string;
}

export interface EditionInfo {
  /** Shown under the product name: "Community edition". */
  edition: string;
  links: EditionLink[];
}

export const EDITION: EditionInfo = {
  edition: "Community",
  links: [
    { labelKey: "about.link.website", url: "https://bskriver.dk" },
    { labelKey: "about.link.help", url: "https://bskriver.dk/help/" },
    // Trailing slash on purpose - without it the site answers with a
    // redirect to the same address with one.
    {
      labelKey: "about.link.openSource",
      url: "https://bskriver.dk/open-source/",
    },
    // This edition IS Apache 2.0, so the licence is worth stating and
    // worth linking.
    {
      labelKey: "about.link.license",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
    },
  ],
};
