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
    version: '0.8.0',
    date: '07/11/2026',
    pt: [
      'Clássicos (Fla-Flu, Gre-Nal, Boca x River, Real x Barça e os outros grandes de cada cidade): valem o dobro para a torcida e mais para a diretoria, enchem o estádio, têm narração própria e um retrospecto entre os dois clubes.',
      'Retrospectiva no fim da temporada: campanha, objetivo, copas, craque, artilheiro, melhor contratação e a seleção do campeonato. Na tela do treinador, a sala de troféus e os números da carreira (maior vitória, pior derrota, clássicos).',
      'Dia do fechamento da janela: a IA faz o dobro de negócios, chegam propostas de última hora que só valem naquela rodada, e o dia termina com o resumo dos negócios.',
      'Narração: o barulho da torcida cresce com a pressão, o placar pisca nas cores de quem marcou, e há um resumo no intervalo e no fim do jogo.',
      'Avisos no sino do topo em vez de janelas que pulam (propostas, fechamento da janela, escalação, leilões que interessam, diretoria, clássico chegando). Atalhos: Espaço continua (ou pausa o seu jogo), 1 a 9 abrem as telas, N os avisos, ? a lista.',
      'Mercado: coluna "vs. elenco" e, na ficha do jogador, a comparação lado a lado com o seu titular da posição. Dicas explicam a força e as estrelas.',
      'No celular: o menu vira uma faixa no topo e o dia de jogo fica em uma coluna.',
      'Equilíbrio: craques recusam clubes muito menores e cobram mais de quem está um pouco abaixo; veteranos topam voltar para casa; a IA não contrata mais estrelas livres acima do seu nível, e as ligas europeias seguram o nível. A diretoria paga parte das obras do CT quando confia no treinador.',
      'Correções: propostas da IA podiam chegar com a janela já fechada, sem como responder; dava para vender ou leiloar ficando com menos de 16 jogadores; clubes da IA vendiam mesmo com o elenco curto.',
    ],
    en: [
      'Derbies (Fla-Flu, Gre-Nal, Boca v River, Real v Barça and the big clubs of each city): they count double for the fans and more for the board, fill the stadium, get their own commentary and a head-to-head record.',
      'A season review at the end of each season: record, objective, cup runs, player of the season, top scorer, best signing and the league’s team of the season. On the manager screen, a trophy room and career numbers (biggest win, heaviest defeat, derbies).',
      'Transfer deadline day: the AI does twice the business, late bids arrive that are only valid that round, and the day ends with a round-up of the deals.',
      'Commentary: the crowd gets louder with the pressure, the scoreboard flashes in the scorer’s colours, and there is a summary at half-time and full time.',
      'Notifications in the bell at the top instead of pop-ups (bids, the window closing, line-up problems, auctions worth a look, the board, a derby coming up). Shortcuts: Space continues (or pauses your match), 1 to 9 open the screens, N the notifications, ? the list.',
      'Market: a "vs. squad" column and, on the player card, a side-by-side comparison with your starter in that position. Tooltips explain strength and stars.',
      'On phones: the menu becomes a strip at the top and match day fits in one column.',
      'Balance: stars refuse much smaller clubs and ask more from slightly smaller ones; veterans are happy to go home; the AI no longer signs free-agent stars above its level, so the European leagues keep their level. The board pays part of the training-centre works when it trusts the manager.',
      'Fixes: AI bids could arrive after the window had closed, with no way to answer them; you could sell or auction yourself below 16 players; AI clubs sold even with a short squad.',
    ],
  },
  {
    version: '0.7.0',
    date: '06/11/2026',
    pt: [
      'Narração ao vivo no estilo dos antigos Championship Manager: uma linha por vez conta o lance (passe, arrancada, cruzamento, chute e como termina) nas cores do time com a bola; a barra de pressão pende para quem está melhor e o gol pisca nas cores de quem marcou.',
      'Painel com os próximos jogos e o seu pedaço da tabela; Elenco com resumo (força, idade, lesionados, suspensos, cansados, contratos vencendo); Mercado com o filtro "Ao meu alcance".',
      'A janela de leilões só abre sozinha quando há alguém que reforça o seu time, e dá para desligar.',
      'Jogando sozinho, "Continuar" não pergunta mais se todos estão prontos.',
      'Diretoria: quem ganhou um título no clube nas últimas três temporadas leva só metade da culpa por um objetivo não cumprido; técnico desempregado recebe propostas principalmente do país onde trabalhava.',
      'Correções: emprestados com contrato vencendo voltavam com contrato vencido; clubes podiam ficar sem goleiro; a base de um clube abandonado ficava parada para sempre; propostas em aberto por jogadores aposentados; reforços da diretoria vinham fortes demais.',
    ],
    en: [
      'Live commentary the old Championship Manager way: one line at a time tells the move (pass, run, cross, shot and how it ends) on the colours of the team on the ball; the pressure bar tilts toward whoever is on top and a goal flashes in the scorer’s colours.',
      'Dashboard with the next fixtures and your part of the table; Squad with a summary (strength, age, injured, suspended, tired, expiring contracts); Market with a "Within my budget" filter.',
      'The auctions window only opens by itself when someone would strengthen your team, and it can be switched off.',
      'Playing alone, "Continue" no longer asks whether everyone is ready.',
      'Board: a manager who won a trophy at the club in the last three seasons takes only half the blame for a missed objective; unemployed managers get offers mostly from the country they worked in.',
      'Fixes: loaned players whose contract ended came back with an expired contract; clubs could end up without a goalkeeper; an abandoned club’s youth team stayed there forever; open bids for retired players; the board’s emergency signings were too strong.',
    ],
  },
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
