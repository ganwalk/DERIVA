# Deriva

Um jogo 3D numa terra procedural e infinita que se refaz enquanto você atravessa, passando por desertos, savanas, matas, estepes, taiga, tundra e neve. Você começa numa ilha flutuante bem acima das montanhas, pula, mergulha e segue sempre em frente, correndo, deslizando, planando e se pendurando em olhos que flutuam no céu, com uma boca enorme vindo atrás. Manter a velocidade é o jogo: se ela te alcança, te engole. Referências: Journey (movimento e cachecol) e Hylics (estranheza). As cores são as da Terra; o surreal fica por conta das formas.

## Rodando localmente

```
npm install
npm run dev       # http://localhost:5173
npm run build     # gera o site estático em dist/
npm run preview   # serve o dist/ para conferir o build
```

## Publicação

O projeto é um site estático feito com Vite. Na Vercel, importe o repositório em vercel.com/new: o framework Vite é detectado sozinho (build `npm run build`, saída `dist`). A partir daí, cada push na `main` publica.

## Controles

| Tecla | Ação |
| --- | --- |
| Mouse | Mira. A câmera olha um pouco para o lado do ponteiro. |
| A D | Desviar. Fora da ilha você corre sozinho e nunca volta. |
| W | Andar na ilha, antes do salto |
| Espaço | Saltar. Segurar no chão carrega um salto longo. |
| Espaço no ar | Planar enquanto segurar |
| Shift | Deslizar no chão, mergulhar no ar. Segurar ao tocar o chão converte a queda em velocidade. |
| Botão esquerdo | Corda: segure sobre um olho ou sobre o chão e ela te puxa até lá |
| Botão direito ou F | Golpeia a boca sob o ponteiro. Sem alvo, dá um impulso. |
| B | Liga e desliga o pontilhado |
| Esc | Pausa |

## Como funciona

Tudo vive em `src/main.js`, dividido em seções comentadas.

- **Relevo**: ruído de valor com hash inteiro, então a física e a malha leem exatamente o mesmo chão. A malha é uma grade de 161 × 161 que acompanha o jogador e é refeita aos poucos, algumas linhas por quadro, num segundo buffer. De longe, o shader faz o relevo respirar e curvar como um planeta pequeno.
- **Pontilhado**: baseado no `dither.ts` do portfólio. Matriz de Bayer 4 × 4 no pixel da tela, luminância Rec. 601, com as mesmas quatro fases a cada 175 ms. Mais suave que o original: o limiar só alcança os tons baixos (`uSpread`) e abaixo dele a cor escurece (`uShade`) em vez de virar preto.
- **Biomas**: dois campos lentos de clima, temperatura e umidade, escolhem a cor do chão como na Terra (deserto, savana, mata, estepe, campo, floresta, tundra, taiga, neve). A altitude esfria, as encostas viram rocha e os picos recebem neve. O céu segue o clima do lugar onde você está.
- **Interface**: desenhada num canvas que entra no shader antes do retículo, então texto, painel, mira e mão também viram pontos. O HTML continua na página, invisível, para leitor de tela e teclado.
- **Cachecol**: corrente de Verlet que colide com a túnica e o capuz, então não atravessa o corpo.
- **Trilha**: um eixo que sai da ilha e serpenteia (`courseC`). A velocidade só pode abrir até `MAXANG` da direção da trilha (`keepForward`); andar de ré é cortado, e a partir de `CORR_IN` metros do centro o lado de fora se fecha até empurrar de volta em `CORR_OUT`.
- **A Boca**: uma dentadura humana gigante (gengiva de acrílico rosa, 16 dentes por arcada com incisivos, caninos, pré-molares e molares em medidas reais, escaladas), que morde abrindo a arcada de cima numa dobradiça no fundo. Vem pela trilha atrás de você, de 17 a 58 m/s ao longo do tempo, e acelera se você abrir mais de 200 m. Quando ela chega perto, a câmera sobe e recua por cima dela, para a Boca aparecer em primeiro plano com você à frente. Distância zero, game over. Recomeçar recarrega a página e entra direto no jogo.
- **Física**: passos fixos (4 por quadro). A gravidade da encosta acelera quem desliza, a aterrissagem projeta a velocidade no plano do chão, e a corda é um pêndulo que também puxa.

## Onde mexer

| Quero mudar | Procuro em `src/main.js` |
| --- | --- |
| Forma do relevo | `function height` |
| Força do pontilhado | `uSpread`, `uShade` e `uBias` no `postMat` |
| Cores dos biomas | `fragmentShader` do `terrMat` |
| Tamanho dos biomas | `function climateAt` (e a cópia no shader do relevo) |
| Gravidade | `const G` |
| Velocidade da Boca | `CH.sp` em `updateChaser` |
| Tamanho e dentes da dentadura | `DENT_MM` e `TEETH` |
| Largura da trilha, ângulo máximo | `CORR_IN`, `CORR_OUT`, `MAXANG` |
| Força da corda | `const pull` dentro de `step` |
| Altura da ilha | `ISL.top = peak + 330` |
| Textos do menu | `const TXT` (e a cópia em `index.html`) |
| Cores do céu | `SKY_TOP` e `SKY_HOR` |

O three.js está fixado na versão 0.128.0 de propósito: versões a partir da r152 mudam o gerenciamento de cor e a intensidade das luzes, o que alteraria o visual.

A mão do ponteiro em `public/cursor/` é a mesma do portfólio, com um contorno claro para continuar legível sobre o preto do pontilhado.
