// Algoritmos de grafos da unidade: Dijkstra, A* e Kruskal.
//
// Este módulo não depende da página nem do three.js. Por isso ele também
// roda no Node, e é assim que os testes em tests/ conferem os resultados
// com os do NetworkX.

export const TIPO_ESCADA = 3;

/** Fila de prioridade mínima (heap binário) com pares [prioridade, valor]. */
export class FilaMinima {
  constructor() { this.itens = []; }
  get tamanho() { return this.itens.length; }

  inserir(prioridade, valor) {
    const h = this.itens;
    h.push([prioridade, valor]);
    let i = h.length - 1;
    while (i > 0) {
      const pai = (i - 1) >> 1;
      if (h[pai][0] <= h[i][0]) break;
      [h[pai], h[i]] = [h[i], h[pai]];
      i = pai;
    }
  }

  remover() {
    const h = this.itens;
    const topo = h[0];
    const ultimo = h.pop();
    if (h.length > 0) {
      h[0] = ultimo;
      let i = 0;
      for (;;) {
        const e = 2 * i + 1, d = e + 1;
        let menor = i;
        if (e < h.length && h[e][0] < h[menor][0]) menor = e;
        if (d < h.length && h[d][0] < h[menor][0]) menor = d;
        if (menor === i) break;
        [h[menor], h[i]] = [h[i], h[menor]];
        i = menor;
      }
    }
    return topo;
  }
}

/**
 * Monta o grafo a partir dos vetores compactos do camadas.json.
 * nos: [x0, y0, x1, y1, ...] em metros.  arestas: [i0, j0, tipo0, i1, j1, tipo1, ...].
 * O peso de cada aresta é o comprimento em metros.
 */
export function construirGrafo(nos, arestas) {
  const n = nos.length / 2;
  const adj = Array.from({ length: n }, () => []);
  const lista = [];
  for (let k = 0; k < arestas.length; k += 3) {
    const a = arestas[k], b = arestas[k + 1], tipo = arestas[k + 2];
    const peso = Math.hypot(nos[2 * a] - nos[2 * b], nos[2 * a + 1] - nos[2 * b + 1]);
    const id = lista.length;
    lista.push({ a, b, tipo, peso });
    adj[a].push({ para: b, peso, tipo, id });
    adj[b].push({ para: a, peso, tipo, id });
  }
  return { n, nos, adj, arestas: lista };
}

function reconstruir(anterior, origem, destino) {
  if (origem !== destino && anterior[destino] === -1) return [];
  const caminho = [destino];
  while (caminho[caminho.length - 1] !== origem) caminho.push(anterior[caminho[caminho.length - 1]]);
  return caminho.reverse();
}

/**
 * Busca de caminho mínimo com fila de prioridade.
 * Com heuristica nula é o Dijkstra; com uma heurística admissível é o A*.
 * Devolve a distância, o caminho e a ordem em que os nós foram fechados.
 */
function buscar(grafo, origem, destino, { evitarEscadas = false, heuristica = null } = {}) {
  const dist = new Float64Array(grafo.n).fill(Infinity);
  const anterior = new Int32Array(grafo.n).fill(-1);
  const fechado = new Uint8Array(grafo.n);
  const visitados = [];
  const fila = new FilaMinima();
  dist[origem] = 0;
  fila.inserir(heuristica ? heuristica(origem) : 0, origem);

  while (fila.tamanho > 0) {
    const [, u] = fila.remover();
    if (fechado[u]) continue;            // entrada antiga da fila, já superada
    fechado[u] = 1;
    visitados.push(u);
    if (u === destino) break;
    for (const { para: v, peso, tipo } of grafo.adj[u]) {
      if (fechado[v] || (evitarEscadas && tipo === TIPO_ESCADA)) continue;
      const nova = dist[u] + peso;
      if (nova < dist[v]) {
        dist[v] = nova;
        anterior[v] = u;
        fila.inserir(nova + (heuristica ? heuristica(v) : 0), v);
      }
    }
  }
  return { distancia: dist[destino], caminho: reconstruir(anterior, origem, destino), visitados };
}

export function dijkstra(grafo, origem, destino, opcoes = {}) {
  return buscar(grafo, origem, destino, { ...opcoes, heuristica: null });
}

/**
 * A* com a distância em linha reta até o destino como heurística.
 * Como o peso das arestas é o comprimento, a linha reta nunca superestima
 * o custo restante. A heurística é admissível e o resultado é ótimo.
 */
export function aEstrela(grafo, origem, destino, opcoes = {}) {
  const { nos } = grafo;
  const xd = nos[2 * destino], yd = nos[2 * destino + 1];
  const heuristica = (v) => Math.hypot(nos[2 * v] - xd, nos[2 * v + 1] - yd);
  return buscar(grafo, origem, destino, { ...opcoes, heuristica });
}

/**
 * Dijkstra sem destino: distância da origem a todos os nós.
 * Devolve também o vetor de predecessores, para reconstruir qualquer caminho.
 */
export function dijkstraCompleto(grafo, origem) {
  const dist = new Float64Array(grafo.n).fill(Infinity);
  const anterior = new Int32Array(grafo.n).fill(-1);
  const arestaAnterior = new Int32Array(grafo.n).fill(-1);
  const fechado = new Uint8Array(grafo.n);
  const fila = new FilaMinima();
  dist[origem] = 0;
  fila.inserir(0, origem);
  while (fila.tamanho > 0) {
    const [, u] = fila.remover();
    if (fechado[u]) continue;
    fechado[u] = 1;
    for (const { para: v, peso, id } of grafo.adj[u]) {
      if (fechado[v]) continue;
      const nova = dist[u] + peso;
      if (nova < dist[v]) {
        dist[v] = nova;
        anterior[v] = u;
        arestaAnterior[v] = id;
        fila.inserir(nova, v);
      }
    }
  }
  return { dist, anterior, arestaAnterior };
}

/**
 * Algoritmo de Kruskal sobre uma lista de arestas {a, b, peso} com n vértices.
 * Usa união e busca (union-find) para detectar ciclos.
 * Devolve as arestas na ordem em que foram examinadas, cada uma marcada como
 * aceita ou descartada, para que a página consiga mostrar o passo a passo.
 */
export function kruskalDeArestas(n, arestas) {
  const pai = Int32Array.from({ length: n }, (_, i) => i);
  const posto = new Uint8Array(n);
  const achar = (x) => {
    while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; }   // compressão de caminho
    return x;
  };

  const ordem = arestas.map((_, id) => id).sort((p, q) => arestas[p].peso - arestas[q].peso || p - q);
  const passos = [];
  let peso = 0, aceitas = 0;
  for (const id of ordem) {
    const { a, b, peso: w } = arestas[id];
    const ra = achar(a), rb = achar(b);
    const aceita = ra !== rb;
    if (aceita) {
      if (posto[ra] < posto[rb]) pai[ra] = rb;
      else if (posto[ra] > posto[rb]) pai[rb] = ra;
      else { pai[rb] = ra; posto[ra]++; }
      peso += w;
      aceitas++;
    }
    passos.push({ id, aceita });
  }
  return { passos, peso, aceitas, descartadas: passos.length - aceitas };
}

/** Árvore geradora mínima de todo o grafo de vias. */
export function kruskal(grafo) {
  const resultado = kruskalDeArestas(grafo.n, grafo.arestas);
  return { ...resultado, pesoTotalDoGrafo: grafo.arestas.reduce((s, e) => s + e.peso, 0) };
}

/**
 * Menor rede que liga um conjunto de nós (terminais) seguindo as vias do grafo.
 *
 * 1. Dijkstra a partir de cada terminal dá a distância pela rede entre todos os pares.
 * 2. Essas distâncias formam um grafo completo só com os terminais.
 * 3. Kruskal escolhe as ligações desse grafo completo.
 * 4. Cada ligação aceita volta a ser um caminho de arestas do grafo original.
 *
 * O problema exato (árvore de Steiner) é difícil. Este procedimento é a aproximação
 * clássica, e o custo obtido é no máximo o dobro do ótimo.
 */
export function redeMinimaEntre(grafo, terminais) {
  const buscas = terminais.map((t) => dijkstraCompleto(grafo, t));
  const pares = [];
  for (let i = 0; i < terminais.length; i++) {
    for (let j = i + 1; j < terminais.length; j++) {
      pares.push({ a: i, b: j, peso: buscas[i].dist[terminais[j]] });
    }
  }
  const arvore = kruskalDeArestas(terminais.length, pares);

  const cobertas = new Set();
  const passos = arvore.passos.map(({ id, aceita }) => {
    const { a, b, peso } = pares[id];
    const arestas = [];
    if (aceita) {
      // volta do terminal b até o terminal a pelos predecessores da busca que partiu de a
      for (let v = terminais[b]; v !== terminais[a]; v = buscas[a].anterior[v]) {
        arestas.push(buscas[a].arestaAnterior[v]);
        cobertas.add(buscas[a].arestaAnterior[v]);
      }
    }
    return { a, b, peso, aceita, arestas };
  });
  const comprimentoCoberto = [...cobertas].reduce((s, id) => s + grafo.arestas[id].peso, 0);
  return {
    passos,
    somaDasLigacoes: arvore.peso,
    aceitas: arvore.aceitas,
    descartadas: arvore.descartadas,
    arestasCobertas: [...cobertas],
    comprimentoCoberto,
  };
}
