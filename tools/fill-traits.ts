// Give every real player in the CSVs a fixed set of traits (características), so they are the same in every
// new game and can be edited in the spreadsheet. Known players get their real strengths (list below); the
// rest get traits that fit their position and level, drawn from a seed made of their name. "-" means none.
//   npx tsx tools/fill-traits.ts     (only blank cells are filled; edit a cell to change a player)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomTraits } from '../src/engine/generator';
import { Rng } from '../src/engine/rng';
import type { Pos } from '../src/engine/types';

const KNOWN: Record<string, string> = {
  'Ousmane Diomande': 'velocidade|marcacao',
  'Pedro Gonçalves': 'finalizacao|passe',
  'Uğurcan Çakır': 'reflexos',
  'Milan Škriniar': 'marcacao|lideranca',
  'Piero Hincapié': 'velocidade|marcacao',
  'Jurriën Timber': 'marcacao|drible',
  'Ben White': 'passe|marcacao',
  'Riccardo Calafiori': 'passe|cabeceio',
  'Leandro Trossard': 'drible|finalizacao',
  'Giorgi Mamardashvili': 'reflexos',
  'Milos Kerkez': 'velocidade',
  'Ryan Gravenberch': 'passe|drible',
  'Curtis Jones': 'passe',
  'Hugo Ekitiké': 'drible|velocidade',
  'Cody Gakpo': 'finalizacao|drible',
  'Joško Gvardiol': 'velocidade|passe',
  'Nathan Aké': 'passe|marcacao',
  'Rayan Aït-Nouri': 'drible|velocidade',
  'Mateo Kovačić': 'passe|drible',
  'Tijjani Reijnders': 'passe|finalizacao',
  'Omar Marmoush': 'velocidade|cobrancas',
  'Levi Colwill': 'passe',
  'Marc Cucurella': 'marcacao',
  'Sven Botman': 'cabeceio|marcacao',
  Joelinton: 'cabeceio|marcacao',
  'Ezri Konsa': 'marcacao',
  'Amadou Onana': 'cabeceio|marcacao',
  'Carlos Baleba': 'marcacao|velocidade',
  'Matz Sels': 'reflexos',
  Murillo: 'velocidade|marcacao',
  'Elliot Anderson': 'passe|drible',
  'Dean Henderson': 'reflexos',
  'Daniel Muñoz': 'velocidade',
  'Bernd Leno': 'reflexos',
  'Álvaro Carreras': 'velocidade|drible',
  'Eduardo Camavinga': 'drible|marcacao',
  'Marc-André ter Stegen': 'reflexos|lideranca',
  'Wojciech Szczęsny': 'reflexos',
  'Jules Koundé': 'velocidade|marcacao',
  Gavi: 'passe|marcacao',
  'Dani Olmo': 'passe|finalizacao',
  'Ferran Torres': 'finalizacao',
  'Robin Le Normand': 'cabeceio|marcacao',
  'Dávid Hancko': 'passe|cabeceio',
  'Nahuel Molina': 'velocidade',
  'Pablo Barrios': 'passe|drible',
  'Conor Gallagher': 'marcacao',
  'Nico González': 'passe',
  'Unai Simón': 'reflexos',
  'Oihan Sancet': 'finalizacao|cabeceio',
  'Willian Pacho': 'marcacao|velocidade',
  'Illia Zabarnyi': 'marcacao|cabeceio',
  'Fabián Ruiz': 'passe|cobrancas',
  'Warren Zaïre-Emery': 'passe|marcacao',
  'Gerónimo Rulli': 'reflexos',
  'Benjamin Pavard': 'marcacao|cabeceio',
  'Denis Zakaria': 'marcacao',
  'Marcin Bułka': 'reflexos',
  'Dayot Upamecano': 'velocidade|marcacao',
  'Kim Min-jae': 'marcacao|velocidade',
  'Konrad Laimer': 'marcacao|velocidade',
  'Aleksandar Pavlović': 'passe',
  'Leon Goretzka': 'cabeceio|finalizacao',
  'Serge Gnabry': 'velocidade|finalizacao',
  'Nicolas Jackson': 'velocidade|finalizacao',
  'Nico Schlotterbeck': 'passe|lideranca',
  'Waldemar Anton': 'marcacao',
  'Edmond Tapsoba': 'passe|marcacao',
  'Castello Lukeba': 'velocidade',
  'Alexander Nübel': 'reflexos',
  'Stefan de Vrij': 'cabeceio|lideranca',
  'Manuel Akanji': 'passe|marcacao',
  'Henrikh Mkhitaryan': 'passe|lideranca',
  'Davide Frattesi': 'finalizacao|velocidade',
  'Piotr Zieliński': 'passe|cobrancas',
  'Alex Meret': 'reflexos',
  'Amir Rrahmani': 'cabeceio|lideranca',
  'Alessandro Buongiorno': 'marcacao|cabeceio',
  Anguissa: 'drible|marcacao',
  'Matteo Politano': 'drible|cobrancas',
  'Youssouf Fofana': 'marcacao',
  'Adrien Rabiot': 'passe|cabeceio',
  'Christopher Nkunku': 'drible|finalizacao',
  'Michele Di Gregorio': 'reflexos',
  'Andrea Cambiaso': 'passe|drible',
  'Khéphren Thuram': 'drible|velocidade',
  'Teun Koopmeiners': 'cobrancas|passe',
  'Marco Carnesecchi': 'reflexos',
  Éderson: 'marcacao|passe',
  'Evan Ndicka': 'marcacao',
  'Manu Koné': 'drible|marcacao',
  'Ivan Provedel': 'reflexos',
  'Mario Gila': 'velocidade|marcacao',
  'Mattéo Guendouzi': 'passe|marcacao',
  'Jhon Lucumí': 'passe|velocidade',
};

const dir = 'data/db';
let known = 0;
let generated = 0;
for (const file of readdirSync(dir).filter((f) => /^players-.*\.csv$/.test(f))) {
  const path = `${dir}/${file}`;
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const head = lines[0].split(',');
  const col = (name: string) => head.indexOf(name);
  const [iName, iPos, iStr, iTraits] = [col('name'), col('pos'), col('str'), col('traits')];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split(',');
    while (cells.length < head.length) cells.push('');
    const name = cells[iName];
    if (cells[iTraits]) continue;
    if (KNOWN[name]) {
      cells[iTraits] = KNOWN[name];
      known++;
    } else {
      // seeded by the name: the same player always gets the same traits
      const t = randomTraits(cells[iPos] as Pos, Number(cells[iStr]), Rng.fromSeed(`traits:${name}`));
      cells[iTraits] = t.length ? t.join('|') : '-';
      generated++;
    }
    lines[i] = cells.join(',');
  }
  writeFileSync(path, lines.join(eol));
}
console.log(`${known} known players set, ${generated} filled from position and level`);
