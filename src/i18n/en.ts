// English for every Portuguese text in the game (keys: the Portuguese; {0}, {1}…: names and numbers).
import { EN_ENGINE } from './en-engine';
import { EN_SCREENS } from './en-screens';
import { EN_UI } from './en-ui';

export const EN: Record<string, string> = { ...EN_ENGINE, ...EN_UI, ...EN_SCREENS };
