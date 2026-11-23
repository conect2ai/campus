"""Gera docs/data/camadas.json a partir de um arquivo .osm do OpenStreetMap.

O arquivo de saída alimenta a página interativa (docs/index.html). Ele contém
cinco camadas (base, uso do solo, vias, prédios e árvores) e o grafo de
caminhada usado pelos algoritmos de Dijkstra, A* e Kruskal no navegador.

Uso:
    python src/gerar_camadas.py                      # usa os caminhos padrão
    python src/gerar_camadas.py data/outro.osm docs/data/camadas.json

Só usa a biblioteca padrão do Python, para que qualquer pessoa consiga
reproduzir o resultado sem instalar nada.
"""

from __future__ import annotations

import json
import math
import random
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA_PADRAO = RAIZ / "data" / "ufrn_campus.osm"
SAIDA_PADRAO = RAIZ / "docs" / "data" / "camadas.json"

# A área de estudo é o retângulo que contém a maior parte dos prédios (descartando os
# 3% mais afastados em cada direção), acrescido desta margem em metros. O que fica fora é cortado.
MARGEM_M = 90.0
FRACAO_DESCARTADA = 0.03
ALTURA_ANDAR_M = 3.2
ALTURA_PADRAO_M = 6.0
AREA_POR_ARVORE_M2 = 180.0      # densidade das árvores sorteadas dentro de matas
MAX_ARVORES_SORTEADAS = 1500

# Tipos de via: 0 = carro, 1 = serviço, 2 = pedestre, 3 = escada
TIPO_VIA = {
    "motorway": 0, "trunk": 0, "primary": 0, "secondary": 0, "tertiary": 0,
    "residential": 0, "unclassified": 0, "living_street": 0,
    "motorway_link": 0, "trunk_link": 0, "primary_link": 0, "secondary_link": 0, "tertiary_link": 0,
    "service": 1,
    "footway": 2, "path": 2, "pedestrian": 2, "cycleway": 2, "corridor": 2, "track": 2,
    "steps": 3,
}


def classe_uso_do_solo(tags: dict) -> str | None:
    """Traduz as tags do OSM para as classes desenhadas na camada de uso do solo."""
    if tags.get("natural") == "water" or "water" in tags or tags.get("leisure") == "swimming_pool":
        return "agua"
    if tags.get("natural") in ("wood", "scrub") or tags.get("landuse") == "forest":
        return "mata"
    if tags.get("landuse") == "grass" or tags.get("leisure") in ("park", "garden"):
        return "grama"
    if tags.get("leisure") == "pitch":
        return "quadra"
    if tags.get("amenity") == "parking":
        return "estacionamento"
    if tags.get("natural") == "sand":
        return "areia"
    return None


def area_e_centroide(pts: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Área (m²) e centroide de um polígono simples, pela fórmula do laço."""
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    if abs(a) < 1e-9:
        n = len(pts)
        return 0.0, sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    return abs(a) / 2, cx / (3 * a), cy / (3 * a)


def ponto_dentro(x: float, y: float, pts: list[tuple[float, float]]) -> bool:
    dentro = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            dentro = not dentro
    return dentro


def altura_do_predio(tags: dict) -> float:
    for chave, fator in (("height", 1.0), ("building:levels", ALTURA_ANDAR_M)):
        try:
            return max(3.0, float(str(tags[chave]).replace("m", "").replace(",", ".").strip()) * fator)
        except (KeyError, ValueError):
            continue
    return ALTURA_PADRAO_M


def achatar(pts: list[tuple[float, float]]) -> list[float]:
    return [round(v, 1) for p in pts for v in p]


def gerar(entrada: Path, saida: Path) -> dict:
    raiz = ET.parse(entrada).getroot()

    # ------------------------------------------------------------------ nós
    nos_ll, tags_no = {}, {}
    for n in raiz.iter("node"):
        nos_ll[n.get("id")] = (float(n.get("lat")), float(n.get("lon")))
        t = {x.get("k"): x.get("v") for x in n.iter("tag")}
        if t:
            tags_no[n.get("id")] = t

    vias_osm = {}
    for w in raiz.iter("way"):
        vias_osm[w.get("id")] = (
            [nd.get("ref") for nd in w.iter("nd") if nd.get("ref") in nos_ll],
            {x.get("k"): x.get("v") for x in w.iter("tag")},
        )

    # Prédios mapeados como relação (com pátio interno) usam o anel externo
    for rel in raiz.iter("relation"):
        t = {x.get("k"): x.get("v") for x in rel.iter("tag")}
        if "building" not in t:
            continue
        for m in rel.iter("member"):
            if m.get("type") == "way" and m.get("role") in ("outer", "outline", "") and m.get("ref") in vias_osm:
                refs, tw = vias_osm[m.get("ref")]
                if "building" not in tw:
                    vias_osm[m.get("ref")] = (refs, {**t, **tw})

    # ------------------------------------------- projeção local em metros
    # A origem é o centro dos prédios. Em 2 km o erro da projeção plana é desprezível.
    refs_predios = [r for refs, t in vias_osm.values() if "building" in t for r in refs]
    lat0 = sum(nos_ll[r][0] for r in refs_predios) / len(refs_predios)
    lon0 = sum(nos_ll[r][1] for r in refs_predios) / len(refs_predios)
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110540.0

    def xy(ref: str) -> tuple[float, float]:
        la, lo = nos_ll[ref]
        return (lo - lon0) * kx, (la - lat0) * ky

    # ------------------------------------------------ prédios e uso do solo
    predios, uso_solo = [], []
    for wid, (refs, t) in vias_osm.items():
        if len(refs) < 4 or refs[0] != refs[-1]:
            continue
        pts = [xy(r) for r in refs[:-1]]
        area, cx, cy = area_e_centroide(pts)
        if "building" in t:
            if area < 8:
                continue
            predios.append({"id": "w" + wid, "nome": t.get("name", ""), "tipo": t["building"],
                            "h": round(altura_do_predio(t), 1), "c": [round(cx, 1), round(cy, 1)],
                            "p": achatar(pts), "_pts": pts, "locais": []})
        else:
            classe = classe_uso_do_solo(t)
            if classe and area >= 20:
                uso_solo.append({"t": classe, "nome": t.get("name", ""), "p": achatar(pts), "_pts": pts, "_area": area})

    xs = sorted(p["c"][0] for p in predios)
    ys = sorted(p["c"][1] for p in predios)
    corte = int(len(predios) * FRACAO_DESCARTADA)
    limites = [xs[corte] - MARGEM_M, ys[corte] - MARGEM_M, xs[-1 - corte] + MARGEM_M, ys[-1 - corte] + MARGEM_M]

    def no_limite(p: tuple[float, float]) -> bool:
        return limites[0] <= p[0] <= limites[2] and limites[1] <= p[1] <= limites[3]

    predios = [p for p in predios if all(no_limite(q) for q in p["_pts"])]
    uso_solo = [u for u in uso_solo if all(no_limite(q) for q in u["_pts"])]

    # ------------------------------------------------------ grafo de vias
    arestas_brutas = []          # (ref_a, ref_b, tipo)
    for refs, t in vias_osm.values():
        tipo = TIPO_VIA.get(t.get("highway", ""))
        if tipo is None or t.get("area") == "yes":
            continue
        for a, b in zip(refs, refs[1:]):
            if a != b and no_limite(xy(a)) and no_limite(xy(b)):
                arestas_brutas.append((a, b, tipo))

    # Mantém só o maior componente conexo, para que toda rota exista
    viz = defaultdict(list)
    for a, b, _ in arestas_brutas:
        viz[a].append(b)
        viz[b].append(a)
    visto, melhor = set(), set()
    for inicio in viz:
        if inicio in visto:
            continue
        comp, pilha = {inicio}, [inicio]
        while pilha:
            for v in viz[pilha.pop()]:
                if v not in comp:
                    comp.add(v)
                    pilha.append(v)
        visto |= comp
        if len(comp) > len(melhor):
            melhor = comp

    indice, nos_xy = {}, []
    for ref in sorted(melhor, key=int):
        indice[ref] = len(nos_xy)
        nos_xy.append(xy(ref))
    arestas, repetidas = [], set()
    for a, b, tipo in arestas_brutas:
        if a in indice and b in indice:
            i, j = sorted((indice[a], indice[b]))
            if (i, j) not in repetidas:
                repetidas.add((i, j))
                arestas.extend((i, j, tipo))

    # Cada prédio é ligado ao nó do grafo mais próximo do seu centroide
    for p in predios:
        cx, cy = p["c"]
        p["no"] = min(range(len(nos_xy)), key=lambda k: (nos_xy[k][0] - cx) ** 2 + (nos_xy[k][1] - cy) ** 2)

    # Estabelecimentos mapeados como pontos dentro de um prédio (lanchonetes, bancos, lojas)
    for ref, t in tags_no.items():
        categoria = next((t[k] for k in ("amenity", "shop", "office", "tourism") if k in t), None)
        if "name" not in t or categoria is None:
            continue
        x, y = xy(ref)
        for p in predios:
            if ponto_dentro(x, y, p["_pts"]):
                p["locais"].append(f"{t['name']} ({categoria})")
                break

    # ------------------------------------------------------------ árvores
    arvores = [xy(ref) for ref, t in tags_no.items() if t.get("natural") == "tree" and no_limite(xy(ref))]
    sorteio, sorteadas = random.Random(3702), []      # semente fixa: o resultado é reproduzível
    for u in uso_solo:
        if u["t"] != "mata":
            continue
        pts = u["_pts"]
        x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
        y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
        tentativas = int((x1 - x0) * (y1 - y0) / AREA_POR_ARVORE_M2)
        for _ in range(tentativas):
            x, y = sorteio.uniform(x0, x1), sorteio.uniform(y0, y1)
            if ponto_dentro(x, y, pts):
                sorteadas.append((x, y))
    sorteio.shuffle(sorteadas)
    arvores += sorteadas[:MAX_ARVORES_SORTEADAS]

    # -------------------------------------------------------------- saída
    for item in predios + uso_solo:
        for chave in [k for k in item if k.startswith("_")]:
            del item[chave]
    uso_solo.sort(key=lambda u: ("agua", "quadra", "estacionamento", "areia", "grama", "mata").index(u["t"]), reverse=True)

    dados = {
        "meta": {
            "titulo": "Campus Central da UFRN",
            "origem": [round(lat0, 6), round(lon0, 6)],
            "limites": [round(v, 1) for v in limites],
            "fonte": "© colaboradores do OpenStreetMap (ODbL)",
            "gerado_em": date.today().isoformat(),
        },
        "uso_solo": uso_solo,
        "grafo": {"nos": achatar(nos_xy), "arestas": arestas},
        "predios": predios,
        "arvores": achatar(arvores),
    }
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return dados


if __name__ == "__main__":
    entrada = Path(sys.argv[1]) if len(sys.argv) > 1 else ENTRADA_PADRAO
    saida = Path(sys.argv[2]) if len(sys.argv) > 2 else SAIDA_PADRAO
    d = gerar(entrada, saida)
    lim = d["meta"]["limites"]
    print(f"Arquivo gerado: {saida} ({saida.stat().st_size / 1e3:.0f} kB)")
    print(f"  área: {lim[2] - lim[0]:.0f} m × {lim[3] - lim[1]:.0f} m")
    print(f"  prédios: {len(d['predios'])} ({sum(1 for p in d['predios'] if p['nome'])} com nome)")
    print(f"  uso do solo: {len(d['uso_solo'])} polígonos")
    print(f"  grafo: {len(d['grafo']['nos']) // 2} nós e {len(d['grafo']['arestas']) // 3} arestas")
    print(f"  árvores: {len(d['arvores']) // 2}")
