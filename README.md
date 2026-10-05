# Deriva

Um jogo 3D num deserto procedural e infinito que se refaz enquanto você atravessa. Você começa numa ilha flutuante bem acima das montanhas, pula, mergulha e segue correndo, deslizando, planando e se pendurando em olhos que flutuam no céu. Referências: Journey (movimento e cachecol) e Hylics (cor e estranheza).

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
| Mouse | Mira. Levar o ponteiro para os lados vira a câmera. |
| W A S D | Andar |
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
- **Pontilhado**: porte do `dither.ts` do portfólio. Matriz de Bayer 4 × 4, luminância Rec. 601, cor original acima do limiar e preto abaixo, com as mesmas quatro fases a cada 175 ms. A cena é renderizada em baixa resolução e o retículo vai por cima.
- **Interface**: desenhada num canvas que entra no shader antes do retículo, então texto, painel, mira e mão também viram pontos. O HTML continua na página, invisível, para leitor de tela e teclado.
- **Física**: passos fixos (4 por quadro). A gravidade da encosta acelera quem desliza, a aterrissagem projeta a velocidade no plano do chão, e a corda é um pêndulo que também puxa.

## Onde mexer

| Quero mudar | Procuro em `src/main.js` |
| --- | --- |
| Forma do relevo | `function height` |
| Força do pontilhado | `uBias` no `postMat` |
| Gravidade | `const G` |
| Força da corda | `const pull` dentro de `step` |
| Altura da ilha | `ISL.top = peak + 330` |
| Textos do menu | `const TXT` (e a cópia em `index.html`) |
| Cores do céu | `function updateAtmos` |

O three.js está fixado na versão 0.128.0 de propósito: versões a partir da r152 mudam o gerenciamento de cor e a intensidade das luzes, o que alteraria o visual.

A mão do ponteiro em `public/cursor/` é a mesma do portfólio, com um contorno claro para continuar legível sobre o preto do pontilhado.
