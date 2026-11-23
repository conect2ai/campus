// Confere os algoritmos da página com os valores calculados pelo NetworkX.
// Execute com:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { construirGrafo, dijkstra, aEstrela, kruskal, kruskalDeArestas, redeMinimaEntre, FilaMinima } from '../docs/js/algoritmos.js';

const ler = (caminho) => JSON.parse(readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), 'utf8'));
const dados = ler('../docs/data/camadas.json');
const referencia = ler('./referencia.json');
const grafo = construirGrafo(dados.grafo.nos, dados.grafo.arestas);
const perto = (obtido, esperado) => assert.ok(Math.abs(obtido - esperado) < 1e-6 * Math.max(1, esperado), `${obtido} ≠ ${esperado}`);

test('a fila de prioridade devolve os itens em ordem crescente', () => {
  const fila = new FilaMinima();
  [5, 1, 4, 1, 9, 2, 6].forEach((p) => fila.inserir(p, p));
  const saida = [];
  while (fila.tamanho) saida.push(fila.remover()[0]);
  assert.deepEqual(saida, [1, 1, 2, 4, 5, 6, 9]);
});

test('Dijkstra e A* chegam à distância do NetworkX', () => {
  for (const par of referencia.pares) {
    const rd = dijkstra(grafo, par.origem, par.destino);
    const ra = aEstrela(grafo, par.origem, par.destino);
    perto(rd.distancia, par.distancia);
    perto(ra.distancia, par.distancia);
    assert.equal(rd.caminho[0], par.origem);
    assert.equal(rd.caminho.at(-1), par.destino);
  }
});

test('o A* nunca visita mais nós do que o Dijkstra', () => {
  for (const par of referencia.pares) {
    const rd = dijkstra(grafo, par.origem, par.destino);
    const ra = aEstrela(grafo, par.origem, par.destino);
    assert.ok(ra.visitados.length <= rd.visitados.length);
  }
});

test('a opção de evitar escadas reproduz o subgrafo sem escadas', () => {
  for (const par of referencia.pares) {
    const r = dijkstra(grafo, par.origem, par.destino, { evitarEscadas: true });
    if (par.distancia_sem_escadas === null) assert.equal(r.distancia, Infinity);
    else perto(r.distancia, par.distancia_sem_escadas);
  }
});

test('Kruskal produz a árvore geradora mínima do NetworkX', () => {
  const r = kruskal(grafo);
  assert.equal(r.aceitas, referencia.agm.arestas);
  assert.equal(r.aceitas, grafo.n - 1);
  perto(r.peso, referencia.agm.peso);
  assert.equal(r.aceitas + r.descartadas, grafo.arestas.length);
});

test('a passarela coberta reproduz o Kruskal do NetworkX sobre as distâncias entre os prédios', () => {
  const { terminais, soma_das_ligacoes: esperado } = referencia.passarela;
  const r = redeMinimaEntre(grafo, terminais);
  perto(r.somaDasLigacoes, esperado);
  assert.equal(r.passos.length, (terminais.length * (terminais.length - 1)) / 2);
  assert.equal(r.aceitas, terminais.length - 1);
  // trechos usados por mais de uma ligação só são contados uma vez
  assert.ok(r.comprimentoCoberto <= r.somaDasLigacoes + 1e-6);
});

test('os trechos cobertos ligam todos os prédios escolhidos', () => {
  const { terminais } = referencia.passarela;
  const r = redeMinimaEntre(grafo, terminais);
  // Se as arestas cobertas ligam os terminais, o Kruskal sobre elas deixa todos no mesmo componente
  const cobertas = r.arestasCobertas.map((id) => grafo.arestas[id]);
  const vizinhos = new Map();
  for (const { a, b } of cobertas) {
    if (!vizinhos.has(a)) vizinhos.set(a, []);
    if (!vizinhos.has(b)) vizinhos.set(b, []);
    vizinhos.get(a).push(b); vizinhos.get(b).push(a);
  }
  const alcancados = new Set([terminais[0]]), pilha = [terminais[0]];
  while (pilha.length) for (const v of vizinhos.get(pilha.pop()) ?? []) if (!alcancados.has(v)) { alcancados.add(v); pilha.push(v); }
  assert.ok(terminais.every((t) => alcancados.has(t)));
});

test('Kruskal descarta a aresta que fecha um ciclo', () => {
  const r = kruskalDeArestas(3, [{ a: 0, b: 1, peso: 1 }, { a: 1, b: 2, peso: 2 }, { a: 0, b: 2, peso: 3 }]);
  assert.deepEqual(r.passos.map((p) => p.aceita), [true, true, false]);
  assert.equal(r.peso, 3);
});
