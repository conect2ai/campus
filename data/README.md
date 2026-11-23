# Dados

| Arquivo | O que é | Como foi obtido |
| --- | --- | --- |
| `ufrn_campus.osm` | Vias, prédios, áreas e pontos do Campus Central da UFRN e do entorno imediato | API Overpass, pelo notebook `notebooks/01_campus_3d_osm2world.ipynb`, em novembro de 2026 |

Os dados são do [OpenStreetMap](https://www.openstreetmap.org/copyright) e estão sob a licença ODbL. Quem reutilizar este arquivo precisa manter o crédito aos colaboradores do OpenStreetMap.

O arquivo `docs/data/camadas.json` é derivado deste e não deve ser editado à mão. Para atualizá-lo, rode `python src/gerar_camadas.py`.
