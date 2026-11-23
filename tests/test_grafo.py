"""Confere o grafo publicado em docs/data/camadas.json com o NetworkX.

Execute com:  pytest
Os valores de referência gravados em tests/referencia.json também são usados
pelo teste em JavaScript (tests/algoritmos.test.mjs), para garantir que os
algoritmos da página chegam aos mesmos resultados do NetworkX.
"""

import json
import math
import re
from itertools import combinations
from pathlib import Path

import networkx as nx
import pytest

RAIZ = Path(__file__).resolve().parent.parent
CAMADAS = RAIZ / "docs" / "data" / "camadas.json"
REFERENCIA = RAIZ / "tests" / "referencia.json"
# Mesma seleção do botão "Usar prédios de aula" da página
PREDIOS_DE_AULA = re.compile(r"^(Setor |Bloco de Aulas|Biblioteca Central|Restaurante Universitário|Escola de Ciência|Centro de Convivência|Instituto Metrópole|Reitoria$)")


def carregar_grafo() -> tuple[nx.Graph, dict]:
    dados = json.loads(CAMADAS.read_text(encoding="utf-8"))
    nos, arestas = dados["grafo"]["nos"], dados["grafo"]["arestas"]
    g = nx.Graph()
    for k in range(0, len(arestas), 3):
        a, b, tipo = arestas[k], arestas[k + 1], arestas[k + 2]
        peso = math.hypot(nos[2 * a] - nos[2 * b], nos[2 * a + 1] - nos[2 * b + 1])
        g.add_edge(a, b, weight=peso, tipo=tipo)
    return g, dados


def calcular_referencia() -> dict:
    g, dados = carregar_grafo()
    predios = [p for p in dados["predios"] if p["nome"]]
    pares = [(predios[i]["no"], predios[-1 - i]["no"]) for i in range(0, 12, 2)]
    sem_escadas = nx.subgraph_view(g, filter_edge=lambda a, b: g[a][b]["tipo"] != 3)

    def distancia(grafo, s, t):
        try:
            return nx.dijkstra_path_length(grafo, s, t)
        except nx.NetworkXNoPath:
            return None

    agm = nx.minimum_spanning_tree(g, algorithm="kruskal")

    # Passarela coberta: Kruskal sobre o grafo completo das distâncias entre os prédios de aula
    terminais = [p["no"] for p in dados["predios"] if PREDIOS_DE_AULA.match(p["nome"])]
    completo = nx.Graph()
    completo.add_nodes_from(range(len(terminais)))
    for i, j in combinations(range(len(terminais)), 2):
        completo.add_edge(i, j, weight=nx.dijkstra_path_length(g, terminais[i], terminais[j]))
    ligacoes = nx.minimum_spanning_tree(completo, algorithm="kruskal")

    return {
        "passarela": {"terminais": terminais, "soma_das_ligacoes": ligacoes.size(weight="weight")},
        "pares": [{"origem": s, "destino": t, "distancia": distancia(g, s, t),
                   "distancia_sem_escadas": distancia(sem_escadas, s, t)} for s, t in pares],
        "agm": {"arestas": agm.number_of_edges(), "peso": agm.size(weight="weight")},
    }


def test_grafo_e_conexo():
    g, dados = carregar_grafo()
    assert nx.is_connected(g)
    assert g.number_of_nodes() == len(dados["grafo"]["nos"]) // 2


def test_todo_predio_esta_ligado_ao_grafo():
    g, dados = carregar_grafo()
    assert all(p["no"] in g for p in dados["predios"])


def test_referencia_esta_atualizada():
    """Se este teste falhar, rode `python tests/test_grafo.py` para regravar a referência."""
    salva = json.loads(REFERENCIA.read_text(encoding="utf-8"))
    atual = calcular_referencia()
    assert atual["agm"]["arestas"] == salva["agm"]["arestas"]
    assert atual["agm"]["peso"] == pytest.approx(salva["agm"]["peso"])
    assert atual["passarela"]["terminais"] == salva["passarela"]["terminais"]
    assert atual["passarela"]["soma_das_ligacoes"] == pytest.approx(salva["passarela"]["soma_das_ligacoes"])
    for a, s in zip(atual["pares"], salva["pares"]):
        assert a["distancia"] == pytest.approx(s["distancia"])


if __name__ == "__main__":
    REFERENCIA.write_text(json.dumps(calcular_referencia(), indent=2), encoding="utf-8")
    print("Referência gravada em", REFERENCIA)
