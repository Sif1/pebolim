// What changed, version by version (newest first). Shown on the home screen in the chosen language.

export interface Release {
  version: string;
  /** dd/mm/yyyy */
  date: string;
  pt: string[];
  en: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.6.0',
    date: '06/11/2026',
    pt: [
      'Jogo inteiro em inglês ou português: troque o idioma na tela inicial ou no menu.',
      'Sons nas partidas: apito para cartões, pênaltis, intervalo e fim de jogo; a torcida vibra com gol do mandante e vaia gol do visitante.',
      'Pênaltis durante o jogo viram o minijogo: você escolhe o batedor, o canto e o lado do goleiro.',
      'Base (juniores) no Elenco: renomeie os garotos, veja potencial, idade e desempenho nos jogos da base; a força só aparece quando sobem.',
      'Relatório do adversário no Painel: provável esquema, forma, destaques, desfalques e dicas do olheiro.',
      'Reuniões da diretoria no meio da temporada e humor da torcida (enche ou esvazia o estádio).',
      'Pré-contratos: assine de graça com quem está no último semestre de contrato. Grandes clubes da IA às vezes põem estrelas à venda.',
      'Equilíbrio: clubes uruguaios e argentinos com força realista; jovens não viram craques tão rápido; calendário cheio pede rodízio.',
      'Diretoria mais justa: avisos antes da demissão, reuniões no meio da temporada, meia culpa para quem está na primeira temporada no clube e sempre há propostas para quem está desempregado.',
      'Renovação automática respeita o orçamento salarial.',
      'Correção: com o elenco curto no fim da temporada, a diretoria contratava sozinha reforços caros acima do nível do clube; agora só completa até 18 jogadores, no nível do clube e dentro do orçamento, e avisa você.',
    ],
    en: [
      'The whole game in English or Portuguese: switch the language on the home screen or in the menu.',
      'Match sounds: the whistle for cards, penalties, half-time and full time; the crowd roars for a home goal and boos an away goal.',
      'Penalties during matches become the mini-game: you pick the taker, the corner and the keeper’s dive.',
      'Youth team in the Squad screen: rename the kids, see potential, age and youth-match form; strength shows only once promoted.',
      'Opponent scouting report on the dashboard: likely shape, form, key players, absentees and the scout’s tips.',
      'Mid-season board meetings and fan mood (it fills or empties the stadium).',
      'Pre-contracts: sign players in the last six months of their contract for free. Big AI clubs sometimes put stars up for sale.',
      'Balance: realistic Uruguayan and Argentine squads; youngsters don’t become stars so fast; a packed calendar needs rotation.',
      'Fairer boards: warnings before a sacking, mid-season meetings, half the blame for a manager in his first season at the club, and job offers always come for the unemployed.',
      'Automatic renewals stay within the wage budget.',
      'Fix: with a short squad at the end of the season the board used to sign expensive players above the club’s level on its own; now it only tops up to 18 players, at the club’s level and within the budget, and tells you.',
    ],
  },
  {
    version: '0.5.0',
    date: '06/11/2026',
    pt: [
      'Lances como no Championship Manager: o campo só se mexe nos lances de perigo, em velocidade de acompanhar; no resto o relógio corre.',
      'Animação 2D mais suave, sem travadinhas.',
      'Retratos em pixel art dos jogadores.',
      'Valores no estilo Brasfoot: digite 2,5kk ou 300k.',
      'Renovação automática de contratos, prazo nas propostas da IA e histórico de leilões.',
      'Confirmações com janela do jogo, estatísticas abaixo da narração, força dos jogadores na partida e cabeçalhos das tabelas alinhados.',
    ],
    en: [
      'Championship Manager-style highlights: the pitch only moves for the chances, at a speed you can follow; the clock runs on in between.',
      'Smoother 2D animation, no more stutters.',
      'Pixel-art player portraits.',
      'Brasfoot-style money: type 2.5kk or 300k.',
      'Automatic contract renewals, deadlines on AI offers and an auction history.',
      'In-game confirmation dialogs, stats under the commentary, player strength during matches and aligned table headers.',
    ],
  },
  {
    version: '0.4.0',
    date: '06/11/2026',
    pt: [
      'Visual de jogo de treinador clássico, escudos reais e nomes como os jogadores são conhecidos.',
      'Gráfico de momento da partida.',
      'Mercado: venda pelo seu preço, empréstimos de 6 ou 12 meses, leilões e filtros com bandeiras.',
      'Potencial em estrelas e características dos jogadores.',
      'Moeda em dólar e economia equilibrada para os clubes.',
      'Disputa de pênaltis jogável, prêmios do mês e cabeçalho da partida com estádio e público.',
      'Motor de jogo e técnico da IA revisados: um bom treinador rende mais que a IA.',
    ],
    en: [
      'Classic manager-game look, real crests and players named as they are known.',
      'Match momentum graph.',
      'Market: sell at your price, 6 or 12-month loans, auctions, and filters with flags.',
      'Potential stars and player traits.',
      'Money in dollars and a balanced club economy.',
      'Playable penalty shootouts, monthly awards and a match header with stadium and crowd.',
      'Match engine and AI coach reviewed: a good manager beats the AI.',
    ],
  },
  {
    version: '0.3.0',
    date: '05/11/2026',
    pt: ['Menu mais simples, com abas.', 'Quem está online no topo da tela.', 'Lances 2D mais lentos.'],
    en: ['A simpler menu with tabs.', 'Who is online at the top of the screen.', 'Slower 2D highlights.'],
  },
  {
    version: '0.2.0',
    date: '05/11/2026',
    pt: [
      'Técnicos da IA que planejam e mudam o jogo ao vivo.',
      'Estatísticas ao vivo, prancheta tática com arrastar e soltar.',
      'Preços de ingresso por setor e competição, obras com prazo.',
      'Proteções do anfitrião contra mensagens inválidas.',
    ],
    en: [
      'AI coaches that plan and change matches live.',
      'Live stats, drag-and-drop tactics board.',
      'Ticket prices per sector and competition, works that take time.',
      'Host protection against invalid messages.',
    ],
  },
  {
    version: '0.1.0',
    date: '05/11/2026',
    pt: [
      'Primeira versão: multiplayer online direto do navegador, clubes e jogadores reais.',
      'Brasil, as 5 grandes ligas da Europa, Argentina, Uruguai e as copas continentais.',
      'Partidas 2D ao vivo, mercado, finanças, estádio, CT, viagens e saves para baixar.',
    ],
    en: [
      'First version: online multiplayer straight from the browser, real clubs and players.',
      'Brazil, the big five European leagues, Argentina, Uruguay and the continental cups.',
      'Live 2D matches, market, finances, stadium, training centre, travel and downloadable saves.',
    ],
  },
];
