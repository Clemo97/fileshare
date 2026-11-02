// SAMPLE DATA for the UI preview. Pairing and the connections list use Supabase when the app
// is configured for it (lib/supabase.ts); otherwise, and always for files and transfer
// progress (WebRTC is not wired in yet), everything the user sees comes from here and from
// demo-store.tsx. Replace both when the shared core lands (plan, Phase 3 and 4).
import type { ThemeName } from '@/theme/colors';

export type Person = {
  id: string;
  colorId: Exclude<ThemeName, 'default'>;
  colorLabel: string;
  animalLabel: string;
  emoji: string;
};

// The web app names every anonymous user "<Colour> <Animal>" (see the colors/animals tables).
export const personName = (person: Person) => `${person.colorLabel} ${person.animalLabel}`;

export const ME: Person = {
  id: 'me',
  colorId: 'violet',
  colorLabel: 'Violet',
  animalLabel: 'Turtle',
  emoji: '🐢',
};

export const PEOPLE = {
  roseSquirrel: {
    id: 'rose-squirrel',
    colorId: 'rose',
    colorLabel: 'Rose',
    animalLabel: 'Squirrel',
    emoji: '🐿️',
  },
  blueRabbit: {
    id: 'blue-rabbit',
    colorId: 'blue',
    colorLabel: 'Blue',
    animalLabel: 'Rabbit',
    emoji: '🐰',
  },
  greenBee: {
    id: 'green-bee',
    colorId: 'green',
    colorLabel: 'Green',
    animalLabel: 'Bee',
    emoji: '🐝',
  },
  orangeCat: {
    id: 'orange-cat',
    colorId: 'orange',
    colorLabel: 'Orange',
    animalLabel: 'Cat',
    emoji: '🐱',
  },
} as const satisfies Record<string, Person>;

export type FileMeta = { name: string; size: number; mimeType: string };

const MB = 1024 * 1024;

export const FILES: FileMeta[] = [
  { name: 'Holiday photos.zip', size: 248 * MB, mimeType: 'application/zip' },
  { name: 'Budget 2026.xlsx', size: 1.2 * MB, mimeType: 'application/vnd.ms-excel' },
  { name: 'Team offsite recording.mp4', size: 412 * MB, mimeType: 'video/mp4' },
];
