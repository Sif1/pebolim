// Name pools for generated players (youth intake and lite-division squads). Fictional combinations.
const pools: Record<string, { first: string; last: string }> = {
  BRA: {
    first:
      'Gabriel Lucas Matheus Pedro Guilherme Rafael Gustavo Felipe João Vinícius Thiago Bruno Rodrigo Diego Caio Leonardo Igor Henrique Murilo Vitor Arthur Davi Eduardo Fernando Marcelo Renan Wesley Kauã Ryan Yuri Luan Alan Everton Wellington Douglas Fabrício Jefferson Juninho Matheuzinho Pablo Samuel Danilo Alex Ramon Cauã Erick Breno Nathan',
    last: 'Silva Santos Oliveira Souza Lima Pereira Costa Rodrigues Almeida Nascimento Ferreira Araújo Ribeiro Carvalho Gomes Martins Rocha Barbosa Melo Cardoso Teixeira Moreira Correia Mendes Freitas Dias Batista Pinto Nunes Vieira Moura Ramos Cavalcante Farias Campos Monteiro Barros Fonseca Andrade Machado Rezende Coelho Brito Lopes Tavares Siqueira',
  },
  ARG: {
    first: 'Santiago Matías Nicolás Lautaro Facundo Agustín Franco Joaquín Tomás Gonzalo Ezequiel Leandro Maximiliano Federico Rodrigo Julián Emiliano Lucas Mauro Cristian Brian Iván Valentín Thiago Nahuel Marcos Alexis Gastón Bruno Kevin',
    last: 'González Rodríguez Fernández López Martínez Gómez Díaz Pérez Sánchez Romero Sosa Torres Álvarez Ruiz Ramírez Flores Acosta Benítez Medina Herrera Suárez Aguirre Giménez Molina Castro Ortiz Silva Núñez Luna Juárez Cabrera Ríos Ferreyra Godoy Morales Domínguez Moreno Peralta Vega Carrizo',
  },
  URU: {
    first: 'Facundo Agustín Nicolás Matías Diego Federico Gonzalo Santiago Maximiliano Rodrigo Juan Sebastián Martín Joaquín Mathías Bruno Franco Brian Emiliano Felipe',
    last: 'Rodríguez González Fernández Pérez Martínez López Silva Sosa Suárez Pereira Cabrera Núñez Olivera Méndez Correa Acosta Castro Píriz Viera Techera Da Silva Rocha Cardozo De León Barreto',
  },
  HIS: {
    first: 'Juan Carlos Andrés Diego Luis Jorge José Sebastián Miguel Felipe Cristian Kevin Jhon Brayan Darwin Wilmer Jefferson Óscar Héctor Daniel Alexander Eduardo Fabián Iván Ángel',
    last: 'García Rodríguez Martínez López González Hernández Pérez Sánchez Ramírez Torres Flores Rivera Gómez Díaz Cruz Morales Ortiz Gutiérrez Chávez Ramos Mendoza Castillo Vargas Rojas Romero Valencia Quintero Cuesta Mina Caicedo',
  },
  ENG: {
    first: 'Jack Harry Oliver Charlie George James Thomas Jacob Alfie Joshua William Daniel Ryan Callum Kyle Luke Jordan Lewis Mason Connor Adam Ben Sam Tom Josh Liam Jake Reece Aaron Dominic',
    last: 'Smith Jones Taylor Brown Williams Wilson Johnson Davies Robinson Wright Thompson Evans Walker White Roberts Green Hall Wood Jackson Clarke Hughes Edwards Turner Hill Moore Cooper Ward Morris King Baker Harrison Morgan Allen Parker Bennett',
  },
  ESP: {
    first: 'Pablo Álvaro Sergio Alejandro Javier Daniel Adrián David Iker Hugo Mario Raúl Diego Marc Jorge Rubén Unai Aitor Borja Pedro Gonzalo Víctor Íñigo Óscar Nacho',
    last: 'García Fernández González Rodríguez López Martínez Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Muñoz Álvarez Romero Navarro Torres Domínguez Gil Vázquez Serrano Ramos Blanco Molina Morales Ortega Delgado Castro Rubio Marín Iglesias',
  },
  ITA: {
    first: 'Lorenzo Alessandro Francesco Andrea Matteo Leonardo Gabriele Riccardo Tommaso Federico Davide Marco Luca Simone Giorgio Nicolò Pietro Filippo Giacomo Daniele Stefano Mattia Emanuele Manuel Samuele',
    last: 'Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti De Luca Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli Martini Leone Longo Gentile Martinelli Vitale',
  },
  GER: {
    first: 'Lukas Leon Finn Jonas Paul Luis Felix Maximilian Elias Noah Tim Niklas Jan Moritz Florian Julian David Tobias Kevin Marco Dennis Lennart Jannik Nico Fabian',
    last: 'Müller Schmidt Schneider Fischer Weber Meyer Wagner Becker Schulz Hoffmann Schäfer Koch Bauer Richter Klein Wolf Schröder Neumann Schwarz Zimmermann Braun Krüger Hofmann Hartmann Lange Schmitt Werner Krause Meier Lehmann Kaiser Fuchs Vogel Keller Frank',
  },
  FRA: {
    first: 'Lucas Hugo Louis Gabriel Arthur Jules Adam Raphaël Théo Nathan Mathis Enzo Tom Maxime Antoine Kylian Ibrahima Moussa Mamadou Youssouf Bilal Rayan Yanis Clément Quentin',
    last: 'Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefebvre Michel Garcia David Bertrand Roux Vincent Fournier Morel Girard André Mercier Dupont Lambert Bonnet François Martinez Diallo Traoré Koné Camara Cissé Touré',
  },
  POR: {
    first: 'João Rodrigo Diogo Tiago Gonçalo Rúben Bruno André Rafael Pedro Francisco Miguel Nuno Ricardo Vítor Bernardo Duarte Fábio Hugo Luís',
    last: 'Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Sousa Fernandes Gonçalves Gomes Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira Moreira Correia Mendes Nunes Vieira',
  },
  NED: {
    first: 'Daan Sem Lucas Milan Levi Luuk Thijs Jesse Bram Stijn Ruben Tim Kevin Jasper Thomas Lars Joey Bart Wout Jens',
    last: 'de Jong Jansen de Vries van den Berg van Dijk Bakker Janssen Visser Smit Meijer de Boer Mulder de Groot Bos Vos Peters Hendriks van Leeuwen Dekker Brouwer Maes Peeters Claes Wouters Jacobs',
  },
  TUR: {
    first: 'Mehmet Mustafa Ahmet Ali Hüseyin Hasan Emre Burak Can Kerem Arda Eren Yusuf Ömer Murat Okan Cenk Serkan Orkun Barış',
    last: 'Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek',
  },
};

const NAT_POOL: Record<string, string> = {
  BRA: 'BRA',
  ARG: 'ARG',
  URU: 'URU',
  COL: 'HIS',
  CHI: 'HIS',
  PAR: 'HIS',
  ECU: 'HIS',
  PER: 'HIS',
  BOL: 'HIS',
  VEN: 'HIS',
  MEX: 'HIS',
  ENG: 'ENG',
  SCO: 'ENG',
  WAL: 'ENG',
  IRL: 'ENG',
  USA: 'ENG',
  ESP: 'ESP',
  ITA: 'ITA',
  GER: 'GER',
  AUT: 'GER',
  SUI: 'GER',
  FRA: 'FRA',
  BEL: 'NED',
  NED: 'NED',
  POR: 'POR',
  TUR: 'TUR',
};

export function poolFor(nat: string): string {
  return NAT_POOL[nat] ?? 'ENG';
}

export function defaultNamePools(): Record<string, { first: string[]; last: string[] }> {
  const out: Record<string, { first: string[]; last: string[] }> = {};
  for (const [k, v] of Object.entries(pools)) {
    out[k] = { first: v.first.split(' '), last: splitLast(v.last) };
  }
  return out;
}

// Keep particles such as "de Jong", "van den Berg", "De León", "Da Silva" together.
function splitLast(s: string): string[] {
  const words = s.split(' ');
  const out: string[] = [];
  let buf: string[] = [];
  for (const w of words) {
    buf.push(w);
    if (/^(de|van|den|der|De|Da|da|von)$/.test(w)) continue;
    out.push(buf.join(' '));
    buf = [];
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}
