/** Small text helpers of the shell (kept out of component files so fast refresh works). */
import { nb } from '../i18n/nb';

/** Subtitle: the project name, plus the place unless the name already contains it. */
export function projectSubtitle(name: string): string {
  return name.includes(nb.app.place) ? name : `${name} · ${nb.app.place}`;
}
