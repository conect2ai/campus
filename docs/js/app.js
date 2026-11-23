// Página interativa do repositório modelo.
//
// Lê docs/data/camadas.json (gerado por src/gerar_camadas.py), desenha o campus
// em cinco camadas com three.js e executa Dijkstra, A* e Kruskal no navegador.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { construirGrafo, dijkstra, aEstrela, redeMinimaEntre } from './algoritmos.js';

// ------------------------------------------------------------------ configuração
const CAMADAS = [
  { id: 'base',    nome: 'Base',        cor: '#d8d1bb', placa: '#d8d1bb', descricao: 'área de estudo' },
  { id: 'uso',     nome: 'Uso do solo', cor: '#a9cf8a', placa: '#eef2e4', descricao: 'grama, mata, água, estacionamentos' },
  { id: 'vias',    nome: 'Vias',        cor: '#4a4f57', placa: '#f1f0ec', descricao: 'o grafo dos algoritmos' },
  { id: 'predios', nome: 'Prédios',     cor: '#f4f1ea', placa: '#dfe3e6', descricao: 'clique para selecionar' },
  { id: 'arvores', nome: 'Árvores',     cor: '#2f7d3b', placa: '#eaf1e6', descricao: 'mapeadas e sorteadas nas matas' },
];
const DISTANCIA_ENTRE_CAMADAS = 300;      // metros, com o controle no máximo
const COR_USO = { agua: '#6fa8dc', mata: '#5f9a5a', grama: '#a9cf8a', quadra: '#7fbf6b', estacionamento: '#b9bcc2', areia: '#ead9a0' };
const VIAS = [                              // índice = tipo da aresta no camadas.json
  { nome: 'carro',    cor: '#4a4f57', largura: 7 },
  { nome: 'serviço',  cor: '#80858d', largura: 4 },
  { nome: 'pedestre', cor: '#b08a4f', largura: 2.2 },
  { nome: 'escada',   cor: '#8e5fb0', largura: 2.6 },
];
const COR = { predio: '#f4f1ea', origem: '#1a9850', destino: '#d7301f', rota: '#ff1f8f',
              dijkstra: '#2b6cff', aestrela: '#ff7a1a', marcado: '#35b3ac', passarela: '#ffe600', examinando: '#e2553f' };
const SEM_ANIMACAO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const metros = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`
                                 : `${Math.round(m).toLocaleString('pt-BR')} m`);
const inteiro = (n) => n.toLocaleString('pt-BR');

// ------------------------------------------------------------------ cena
const recipiente = $('cena');
const renderizador = new THREE.WebGLRenderer({ antialias: true });
renderizador.setPixelRatio(Math.min(window.devicePixelRatio, 2));
recipiente.appendChild(renderizador.domElement);

const cena = new THREE.Scene();
cena.background = new THREE.Color('#8b958a');
cena.add(new THREE.HemisphereLight(0xffffff, 0x77806f, 1.9));
const sol = new THREE.DirectionalLight(0xffffff, 1.5);
sol.position.set(-0.6, 1, 0.45);
cena.add(sol);

const camera = new THREE.PerspectiveCamera(38, 1, 5, 40000);
const controles = new OrbitControls(camera, renderizador.domElement);
controles.maxPolarAngle = Math.PI / 2 - 0.03;
controles.minDistance = 120;
controles.maxDistance = 9000;

let precisaDesenhar = true;
const pedirDesenho = () => { precisaDesenhar = true; };
controles.addEventListener('change', pedirDesenho);

function ajustarTamanho() {
  const { clientWidth: w, clientHeight: h } = recipiente;
  renderizador.setSize(w, h);
  // Em telas largas o painel cobre a direita, então o centro da cena é deslocado para a área livre
  const painel = $('painel').getBoundingClientRect();
  const coberto = w > 760 ? w - painel.left : 0;
  camera.aspect = (w + coberto) / h;
  camera.setViewOffset(w + coberto, h, coberto, 0, w, h);
  camera.updateProjectionMatrix();
  pedirDesenho();
}
window.addEventListener('resize', ajustarTamanho);

// ------------------------------------------------------------------ geometria auxiliar
// O plano do mapa é (x = leste, y = norte). Na cena, y aponta para cima e o norte é -z.

/**
 * Faixas (dois triângulos por segmento) para desenhar arestas com largura em metros.
 * Com juntas = true, cada ponta de segmento ganha um disco, para as curvas ficarem contínuas.
 */
function geometriaDeFaixas(segmentos, largura, altura, juntas = false) {
  const LADOS = 10;
  const pos = new Float32Array(segmentos.length * (18 + (juntas ? 2 * LADOS * 9 : 0)));
  let k = 0;
  const disco = (cx, cy) => {
    for (let i = 0; i < LADOS; i++) {
      const a1 = (i / LADOS) * 2 * Math.PI, a2 = ((i + 1) / LADOS) * 2 * Math.PI;
      for (const [px, py] of [[cx, cy], [cx + Math.cos(a1) * largura / 2, cy + Math.sin(a1) * largura / 2],
                              [cx + Math.cos(a2) * largura / 2, cy + Math.sin(a2) * largura / 2]]) {
        pos[k++] = px; pos[k++] = altura; pos[k++] = -py;
      }
    }
  };
  for (const [x1, y1, x2, y2] of segmentos) {
    if (juntas) { disco(x1, y1); disco(x2, y2); }
    const dx = x2 - x1, dy = y2 - y1, comp = Math.hypot(dx, dy) || 1;
    const nx = (-dy / comp) * largura / 2, ny = (dx / comp) * largura / 2;
    const cantos = [[x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos[k++] = cantos[i][0]; pos[k++] = altura; pos[k++] = -cantos[i][1];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function formaDoPoligono(p) {
  const forma = new THREE.Shape();
  forma.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) forma.lineTo(p[i], p[i + 1]);
  forma.closePath();
  return forma;
}

/**
 * Traçado em destaque: uma faixa de cor viva sobre um contorno contrastante.
 * Com as camadas juntas ele é desenhado por cima de tudo, para os prédios não o esconderem.
 */
function tracadoEmDestaque(segmentos, cor, corDoContorno, largura) {
  const camada = (larg, altura, c, ordem) => {
    const malha = new THREE.Mesh(geometriaDeFaixas(segmentos, larg, altura, true),
      new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, depthTest: separacao > 0.03 }));
    malha.renderOrder = ordem;
    malha.userData.destaque = true;
    return malha;
  };
  const contorno = camada(largura * 1.75, 2.4, corDoContorno, 10);
  contorno.add(camada(largura, 2.7, cor, 11));
  return contorno;
}

const materialPlano = (cor, extra = {}) => new THREE.MeshLambertMaterial({ color: cor, side: THREE.DoubleSide, ...extra });

// ------------------------------------------------------------------ estado
const grupos = {};          // id da camada -> THREE.Group
const placas = [];          // placas translúcidas que aparecem quando as camadas se separam
const rotulos = [];
let dados, grafo, limites;
let malhasPredios = [];
let separacao = 0;
const estado = { origem: null, destino: null, resultados: null,
                 passarela: { marcando: false, marcados: new Set(), temporizador: null } };
const sobreposicoes = { rota: null, visitados: null, passarela: null, examinando: null };
// Prédios sugeridos para a passarela: salas de aula e serviços de uso diário
const PREDIOS_DE_AULA = /^(Setor |Bloco de Aulas|Biblioteca Central|Restaurante Universitário|Escola de Ciência|Centro de Convivência|Instituto Metrópole|Reitoria$)/;

// ------------------------------------------------------------------ construção das camadas
function criarCamadas() {
  const [x0, y0, x1, y1] = limites;
  const largura = x1 - x0, profundidade = y1 - y0;
  const cx = (x0 + x1) / 2, cz = -(y0 + y1) / 2;

  CAMADAS.forEach((camada, i) => {
    const grupo = new THREE.Group();
    grupo.name = camada.id;
    grupos[camada.id] = grupo;
    cena.add(grupo);

    const placa = new THREE.Mesh(
      new THREE.BoxGeometry(largura, 4, profundidade),
      new THREE.MeshLambertMaterial({ color: camada.placa, transparent: i > 0, opacity: i > 0 ? 0 : 1 }));
    placa.position.set(cx, -2.6, cz);
    placa.visible = i === 0;
    grupo.add(placa);
    placas.push(placa);

    const rotulo = document.createElement('div');
    rotulo.className = 'rotulo-camada';
    rotulo.textContent = camada.nome;
    rotulo.style.opacity = 0;
    $('rotulos').appendChild(rotulo);
    rotulos.push(rotulo);
  });

  // Uso do solo: um polígono plano por área mapeada
  dados.uso_solo.forEach((u, k) => {
    const malha = new THREE.Mesh(new THREE.ShapeGeometry(formaDoPoligono(u.p)), materialPlano(COR_USO[u.t]));
    malha.rotation.x = -Math.PI / 2;
    malha.position.y = 0.2 + k * 0.004;        // evita cintilação entre polígonos sobrepostos
    grupos.uso.add(malha);
  });

  // Vias: as arestas do grafo, agrupadas por tipo
  const { nos } = grafo;
  VIAS.forEach((via, tipo) => {
    const segmentos = grafo.arestas.filter((e) => e.tipo === tipo)
      .map((e) => [nos[2 * e.a], nos[2 * e.a + 1], nos[2 * e.b], nos[2 * e.b + 1]]);
    if (segmentos.length) grupos.vias.add(new THREE.Mesh(geometriaDeFaixas(segmentos, via.largura, 0.5 + tipo * 0.05), materialPlano(via.cor)));
  });

  // Prédios: a planta extrudada pela altura. Cada prédio é uma malha, para permitir o clique.
  malhasPredios = dados.predios.map((p, indice) => {
    const geometria = new THREE.ExtrudeGeometry(formaDoPoligono(p.p), { depth: p.h, bevelEnabled: false });
    const malha = new THREE.Mesh(geometria, new THREE.MeshLambertMaterial({ color: COR.predio }));
    malha.rotation.x = -Math.PI / 2;
    malha.userData.indice = indice;
    grupos.predios.add(malha);
    return malha;
  });

  // Árvores: instâncias de um mesmo cone
  const total = dados.arvores.length / 2;
  const copas = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 9, 7), new THREE.MeshLambertMaterial({ color: '#2f7d3b' }), total);
  const m = new THREE.Matrix4();
  for (let i = 0; i < total; i++) {
    const escala = 0.75 + ((i * 37) % 50) / 100;
    m.makeScale(escala, escala, escala).setPosition(dados.arvores[2 * i], 4.5 * escala + 0.5, -dados.arvores[2 * i + 1]);
    copas.setMatrixAt(i, m);
  }
  grupos.arvores.add(copas);
}

function montarListaDeCamadas() {
  const lista = $('lista-camadas');
  [...CAMADAS].reverse().forEach((camada) => {
    const item = document.createElement('li');
    item.innerHTML = `<label><input type="checkbox" checked data-camada="${camada.id}">
      <span class="amostra" style="background:${camada.cor}"></span>
      <span>${camada.nome} <small>· ${camada.descricao}</small></span></label>`;
    lista.appendChild(item);
  });
  lista.addEventListener('change', (e) => {
    const id = e.target.dataset.camada;
    if (!id) return;
    grupos[id].visible = e.target.checked;
    atualizarRotulos();
    pedirDesenho();
  });
}

// ------------------------------------------------------------------ separação das camadas
function aplicarSeparacao(valor) {
  const anterior = separacao;
  separacao = valor;
  CAMADAS.forEach((camada, i) => {
    grupos[camada.id].position.y = i * DISTANCIA_ENTRE_CAMADAS * valor;
    if (i > 0) {
      // As placas surgem aos poucos e ficam opacas, como folhas empilhadas
      const opacidade = Math.min(1, valor * 4);
      placas[i].visible = $('mostrar-placas').checked && valor > 0.01;
      placas[i].material.opacity = opacidade;
      placas[i].material.transparent = opacidade < 1;
      placas[i].material.needsUpdate = true;
    }
  });
  // Com as camadas separadas, os traçados em destaque voltam a respeitar a profundidade,
  // para não aparecerem através das placas de cima
  cena.traverse((o) => { if (o.userData.destaque) o.material.depthTest = valor > 0.03; });
  // A câmera acompanha o centro da pilha, para o conjunto continuar enquadrado
  // e se afasta um pouco, para a pilha inteira caber na tela
  const meio = ((CAMADAS.length - 1) / 2) * DISTANCIA_ENTRE_CAMADAS;
  const afastamento = (1 + 0.5 * valor) / (1 + 0.5 * anterior);
  camera.position.sub(controles.target).multiplyScalar(afastamento);
  controles.target.y += meio * (valor - anterior);
  camera.position.add(controles.target);
  controles.update();
  pedirDesenho();
}

const cantoProjetado = new THREE.Vector3();
function atualizarRotulos() {
  const [x0, y0, x1, y1] = limites;
  const { clientWidth: w, clientHeight: h } = recipiente;
  CAMADAS.forEach((camada, i) => {
    const grupo = grupos[camada.id];
    const rotulo = rotulos[i];
    if (separacao < 0.12 || !grupo.visible) { rotulo.style.opacity = 0; return; }
    // Usa o canto da placa que aparece mais à esquerda na tela
    let melhor = null;
    for (const [x, y] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) {
      cantoProjetado.set(x, grupo.position.y, -y).project(camera);
      if (cantoProjetado.z < 1 && (!melhor || cantoProjetado.x < melhor.x)) melhor = cantoProjetado.clone();
    }
    if (!melhor) { rotulo.style.opacity = 0; return; }
    rotulo.style.left = `${Math.max(110, (melhor.x * 0.5 + 0.5) * w)}px`;
    rotulo.style.top = `${(-melhor.y * 0.5 + 0.5) * h}px`;
    rotulo.style.opacity = 1;
  });
}

// ------------------------------------------------------------------ câmera
function enquadrar(inclinada) {
  const [x0, y0, x1, y1] = limites;
  const cx = (x0 + x1) / 2, cz = -(y0 + y1) / 2;
  const alturaAlvo = ((CAMADAS.length - 1) / 2) * DISTANCIA_ENTRE_CAMADAS * separacao;
  // Em telas estreitas a câmera se afasta, para a largura do mapa caber
  const tamanho = Math.max(x1 - x0, y1 - y0) * (1 + 0.5 * separacao) * Math.max(1, 1.25 / camera.aspect);
  controles.target.set(cx, alturaAlvo, cz);
  if (inclinada) camera.position.set(cx - tamanho * 0.8, alturaAlvo + tamanho * 0.5, cz + tamanho * 1.0);
  else camera.position.set(cx, alturaAlvo + tamanho * 1.6, cz + 1);
  controles.update();
  pedirDesenho();
}

// ------------------------------------------------------------------ menor caminho
function removerSobreposicao(chave) {
  const objeto = sobreposicoes[chave];
  if (!objeto) return;
  objeto.parent.remove(objeto);
  objeto.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  sobreposicoes[chave] = null;
}

function pintarPredios() {
  malhasPredios.forEach((malha, i) => {
    malha.material.color.set(i === estado.origem ? COR.origem : i === estado.destino ? COR.destino
      : estado.passarela.marcados.has(i) ? COR.marcado : COR.predio);
  });
}

function desenharVisitados() {
  removerSobreposicao('visitados');
  if (!estado.resultados) return;
  const qual = document.querySelector('input[name="explorados"]:checked').value;
  const visitados = estado.resultados[qual].visitados;
  const pos = new Float32Array(visitados.length * 3);
  visitados.forEach((no, k) => {
    pos[3 * k] = grafo.nos[2 * no]; pos[3 * k + 1] = 2.0; pos[3 * k + 2] = -grafo.nos[2 * no + 1];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pontos = new THREE.Points(g, new THREE.PointsMaterial({ color: COR[qual], size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.75 }));
  grupos.vias.add(pontos);
  sobreposicoes.visitados = pontos;
  pedirDesenho();
}

function calcularRota() {
  removerSobreposicao('rota');
  removerSobreposicao('visitados');
  estado.resultados = null;
  const tabela = $('tabela-rotas'), nota = $('nota-rotas');
  if (estado.origem === null || estado.destino === null) {
    tabela.hidden = true; nota.hidden = true;
    pedirDesenho();
    return;
  }
  const s = dados.predios[estado.origem].no, t = dados.predios[estado.destino].no;
  const opcoes = { evitarEscadas: $('evitar-escadas').checked };
  const rd = dijkstra(grafo, s, t, opcoes), ra = aEstrela(grafo, s, t, opcoes);
  estado.resultados = { dijkstra: rd, aestrela: ra };

  tabela.hidden = false; nota.hidden = false;
  const semCaminho = !Number.isFinite(rd.distancia);
  $('d-dist').textContent = semCaminho ? 'sem caminho' : metros(rd.distancia);
  $('a-dist').textContent = semCaminho ? 'sem caminho' : metros(ra.distancia);
  $('d-vis').textContent = inteiro(rd.visitados.length);
  $('a-vis').textContent = inteiro(ra.visitados.length);
  $('instrucao').textContent = semCaminho
    ? 'Não há caminho entre esses prédios com as restrições escolhidas.'
    : 'Clique em outro prédio para começar uma nova rota.';

  if (!semCaminho && rd.caminho.length > 1) {
    const { nos } = grafo;
    const segmentos = rd.caminho.slice(1).map((v, k) => {
      const u = rd.caminho[k];
      return [nos[2 * u], nos[2 * u + 1], nos[2 * v], nos[2 * v + 1]];
    });
    const rota = tracadoEmDestaque(segmentos, COR.rota, '#ffffff', 13);
    grupos.vias.add(rota);
    sobreposicoes.rota = rota;
  }
  desenharVisitados();
}

function mostrarSelecao(indice) {
  const p = dados.predios[indice];
  const locais = p.locais.length ? `<p>Neste prédio</p><ul>${p.locais.map((l) => `<li>${escapar(l)}</li>`).join('')}</ul>` : '';
  $('selecao').innerHTML = `<h3>${p.nome ? escapar(p.nome) : 'Sem nome no OpenStreetMap'}</h3>
    <p>Altura no modelo de ${p.h.toLocaleString('pt-BR')} m</p>${locais}
    <p><a href="https://www.openstreetmap.org/way/${p.id.slice(1)}" target="_blank" rel="noopener">Abrir no OpenStreetMap</a></p>`;
  $('secao-selecao').hidden = false;
}
const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nomeDoPredio = (i) => dados.predios[i].nome || `Prédio ${dados.predios[i].id}`;

function clicarPredio(indice) {
  if (estado.passarela.marcando) { alternarMarcado(indice); mostrarSelecao(indice); return; }
  if (estado.origem === null || estado.destino !== null) {
    estado.origem = indice; estado.destino = null;
    $('instrucao').textContent = 'Agora clique no prédio de destino.';
  } else if (indice !== estado.origem) {
    estado.destino = indice;
  }
  $('nome-origem').textContent = estado.origem === null ? 'não definida' : nomeDoPredio(estado.origem);
  $('nome-destino').textContent = estado.destino === null ? 'não definido' : nomeDoPredio(estado.destino);
  pintarPredios();
  mostrarSelecao(indice);
  calcularRota();
}

function limparRota() {
  estado.origem = estado.destino = null;
  $('nome-origem').textContent = 'não definida';
  $('nome-destino').textContent = 'não definido';
  $('instrucao').textContent = 'Clique em um prédio para definir a origem.';
  pintarPredios();
  calcularRota();
}

// Clique (e não arrasto) sobre um prédio
const raio = new THREE.Raycaster(), ponteiro = new THREE.Vector2();
let inicioDoClique = null;
renderizador.domElement.addEventListener('pointerdown', (e) => { inicioDoClique = [e.clientX, e.clientY]; });
renderizador.domElement.addEventListener('pointerup', (e) => {
  if (!inicioDoClique || Math.hypot(e.clientX - inicioDoClique[0], e.clientY - inicioDoClique[1]) > 5) return;
  if (!grupos.predios.visible) return;
  const area = renderizador.domElement.getBoundingClientRect();
  ponteiro.set(((e.clientX - area.left) / area.width) * 2 - 1, -((e.clientY - area.top) / area.height) * 2 + 1);
  raio.setFromCamera(ponteiro, camera);
  const acerto = raio.intersectObjects(malhasPredios, false)[0];
  if (acerto) clicarPredio(acerto.object.userData.indice);
});

// ------------------------------------------------------------------ passarela coberta (Dijkstra + Kruskal)
function atualizarContagem() {
  const n = estado.passarela.marcados.size;
  $('contagem-marcados').textContent = n === 0 ? 'Nenhum prédio marcado.'
    : n === 1 ? '1 prédio marcado. Marque pelo menos mais um.' : `${n} prédios marcados.`;
  $('calcular-passarela').disabled = n < 2;
}

function limparResultadoDaPassarela() {
  clearTimeout(estado.passarela.temporizador);
  removerSobreposicao('passarela');
  removerSobreposicao('examinando');
  for (const id of ['resultado-passarela', 'nota-passarela', 'passos-passarela']) $(id).hidden = true;
  pedirDesenho();
}

function alternarMarcado(indice) {
  const { marcados } = estado.passarela;
  if (marcados.has(indice)) marcados.delete(indice); else marcados.add(indice);
  limparResultadoDaPassarela();          // o resultado anterior deixa de valer
  atualizarContagem();
  pintarPredios();
  pedirDesenho();
}

function definirModoDeMarcacao(ligado) {
  estado.passarela.marcando = ligado;
  $('marcar-predios').setAttribute('aria-pressed', String(ligado));
  $('marcar-predios').textContent = ligado ? 'Concluir marcação' : 'Marcar prédios no mapa';
  $('instrucao').textContent = ligado ? 'Os cliques no mapa estão marcando prédios para a passarela.'
    : 'Clique em um prédio para definir a origem.';
}

function marcarPrediosDeAula() {
  estado.passarela.marcados = new Set(dados.predios.map((p, i) => (PREDIOS_DE_AULA.test(p.nome) ? i : -1)).filter((i) => i >= 0));
  limparResultadoDaPassarela();
  atualizarContagem();
  pintarPredios();
  pedirDesenho();
}

function limparPassarela() {
  estado.passarela.marcados.clear();
  definirModoDeMarcacao(false);
  limparResultadoDaPassarela();
  atualizarContagem();
  pintarPredios();
}

function calcularPassarela() {
  limparResultadoDaPassarela();
  const indices = [...estado.passarela.marcados];
  if (indices.length < 2) return;
  definirModoDeMarcacao(false);
  const resultado = redeMinimaEntre(grafo, indices.map((i) => dados.predios[i].no));
  const { nos } = grafo;
  const segmentosDe = (idsDeArestas) => idsDeArestas.map((id) => {
    const e = grafo.arestas[id];
    return [nos[2 * e.a], nos[2 * e.a + 1], nos[2 * e.b], nos[2 * e.b + 1]];
  });

  // Grupo que recebe as ligações aceitas, uma a uma
  const passarela = new THREE.Group();
  grupos.vias.add(passarela);
  sobreposicoes.passarela = passarela;

  for (const id of ['resultado-passarela', 'nota-passarela', 'passos-passarela']) $(id).hidden = false;
  const linhas = $('linhas-passarela');
  linhas.innerHTML = '';
  const total = resultado.passos.length;
  const pausa = SEM_ANIMACAO ? 0 : Math.max(25, Math.min(380, 7000 / total));
  const cobertas = new Set();
  let examinadas = 0, aceitas = 0, soma = 0;

  const mostrarMetricas = () => {
    $('p-exam').textContent = `${inteiro(examinadas)} de ${inteiro(total)}`;
    $('p-aceitas').textContent = inteiro(aceitas);
    $('p-desc').textContent = inteiro(examinadas - aceitas);
    $('p-soma').textContent = metros(soma);
    $('p-coberto').textContent = metros([...cobertas].reduce((s, id) => s + grafo.arestas[id].peso, 0));
  };

  const passo = () => {
    removerSobreposicao('examinando');
    linhas.querySelector('.atual')?.classList.remove('atual');
    if (examinadas === total) { mostrarMetricas(); pedirDesenho(); return; }
    const p = resultado.passos[examinadas++];
    const linha = document.createElement('tr');
    linha.className = p.aceita ? 'atual' : 'atual descartada';
    linha.innerHTML = `<td>${escapar(nomeDoPredio(indices[p.a]))} e ${escapar(nomeDoPredio(indices[p.b]))}</td>
      <td>${metros(p.peso)}</td>
      <td class="${p.aceita ? 'decisao-aceita' : 'decisao-descartada'}">${p.aceita ? 'aceita' : 'fecha ciclo'}</td>`;
    linhas.appendChild(linha);
    if (!SEM_ANIMACAO) linha.scrollIntoView({ block: 'nearest' });

    if (p.aceita) {
      aceitas++; soma += p.peso;
      p.arestas.forEach((id) => cobertas.add(id));
      if (p.arestas.length) {
        passarela.add(tracadoEmDestaque(segmentosDe(p.arestas), COR.passarela, '#14181a', 11));
      }
    } else if (!SEM_ANIMACAO) {
      // Ligação descartada: um traço reto entre os dois prédios, só enquanto ela é examinada
      const a = dados.predios[indices[p.a]].c, b = dados.predios[indices[p.b]].c;
      const traco = new THREE.Mesh(geometriaDeFaixas([[a[0], a[1], b[0], b[1]]], 5, 3.0), new THREE.MeshBasicMaterial({ color: COR.examinando, side: THREE.DoubleSide }));
      grupos.vias.add(traco);
      sobreposicoes.examinando = traco;
    }
    mostrarMetricas();
    pedirDesenho();
    estado.passarela.temporizador = setTimeout(passo, pausa);
  };
  passo();
  return resultado;
}

// ------------------------------------------------------------------ interface
function ligarInterface() {
  $('separar').addEventListener('input', (e) => aplicarSeparacao(e.target.value / 100));
  $('mostrar-placas').addEventListener('change', () => aplicarSeparacao(separacao));
  $('vista-topo').addEventListener('click', () => enquadrar(false));
  $('vista-3d').addEventListener('click', () => enquadrar(true));
  $('limpar-rota').addEventListener('click', limparRota);
  $('evitar-escadas').addEventListener('change', calcularRota);
  document.querySelectorAll('input[name="explorados"]').forEach((r) => r.addEventListener('change', desenharVisitados));
  $('marcar-predios').addEventListener('click', () => definirModoDeMarcacao(!estado.passarela.marcando));
  $('predios-de-aula').addEventListener('click', marcarPrediosDeAula);
  $('calcular-passarela').addEventListener('click', calcularPassarela);
  $('limpar-passarela').addEventListener('click', limparPassarela);
  $('abrir-painel').addEventListener('click', () => {
    const fechado = $('painel').classList.toggle('fechado');
    $('abrir-painel').setAttribute('aria-expanded', String(!fechado));
  });

  // No GitHub Pages, o link do rodapé aponta para o repositório que publicou a página
  const pagina = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repositorio = location.pathname.split('/').filter(Boolean)[0];
  if (pagina && repositorio) $('link-repo').href = `https://github.com/${pagina[1]}/${repositorio}`;
}

function quadro() {
  requestAnimationFrame(quadro);
  if (!precisaDesenhar) return;
  precisaDesenhar = false;
  renderizador.render(cena, camera);
  atualizarRotulos();
}

async function iniciar() {
  try {
    const resposta = await fetch('data/camadas.json');
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    dados = await resposta.json();
  } catch (erro) {
    $('carregando').textContent = `Não foi possível carregar data/camadas.json (${erro.message}). Abra a página por um servidor web, e não direto do arquivo.`;
    return;
  }
  limites = dados.meta.limites;
  grafo = construirGrafo(dados.grafo.nos, dados.grafo.arestas);
  criarCamadas();
  montarListaDeCamadas();
  ligarInterface();
  ajustarTamanho();
  enquadrar(true);
  $('carregando').remove();
  quadro();
  // Ganchos usados pelos testes automáticos da página
  window.demo = { estado, dados, grafo, clicarPredio, aplicarSeparacao, marcarPrediosDeAula, calcularPassarela };
}

iniciar();
