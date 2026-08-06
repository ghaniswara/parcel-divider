"""
Shared geometry factories for test fixtures.

``make_rect_topology`` is the primary fixture: n rectangular lots arranged
side-by-side, with exact integer/float widths so expected areas are easy to
assert.

Example (widths=[8, 14, 8], height=10)::

    (0,10)---(8,10)---(22,10)---(30,10)
      |         |          |          |
      | Lot 0  | Lot 1   | Lot 2   |
      |  80 m² |  140 m² |  80 m²  |
      |         |          |          |
    (0,0)----(8,0)----(22,0)----(30,0)

    Total = 300 m², target = 100 m² each.
    Movable edges: at x=8 and x=22.
    Optimal offsets: δ₁ = -2 (edge moves to x=10), δ₂ = +2 (edge moves to x=20).
"""

from __future__ import annotations

from shapely.geometry import Polygon

from pee.model import Topology
from pee.topology import build_topology


def make_rect_topology(widths: list[float], height: float = 10.0) -> Topology:
    """
    Build a Topology for *n* rectangular lots arranged side by side.

    Parameters
    ----------
    widths : list of float
        Width of each lot.  Lots are stacked left-to-right.
    height : float
        Common height for all lots.

    Returns
    -------
    Topology
        A valid topology with no edges initially marked movable.
    """
    total_width = sum(widths)
    outer = Polygon(
        [(0, 0), (total_width, 0), (total_width, height), (0, height)]
    )

    parcel_geoms: list[Polygon] = []
    x = 0.0
    for w in widths:
        parcel_geoms.append(
            Polygon([(x, 0), (x + w, 0), (x + w, height), (x, height)])
        )
        x += w

    return build_topology(outer, parcel_geoms)


def make_geojson(widths: list[float], height: float = 10.0) -> dict:
    """
    Return an internal-format GeoJSON dict for *n* rectangular lots.

    The outer boundary and all parcel polygons are encoded as GeoJSON Polygon
    geometries with closed rings.
    """
    total_width = sum(widths)

    outer_coords = [
        [0, 0], [total_width, 0],
        [total_width, height], [0, height], [0, 0],
    ]

    parcels = []
    x = 0.0
    for w in widths:
        ring = [
            [x, 0], [x + w, 0],
            [x + w, height], [x, height], [x, 0],
        ]
        parcels.append({"type": "Polygon", "coordinates": [ring]})
        x += w

    return {
        "outer": {"type": "Polygon", "coordinates": [outer_coords]},
        "parcels": parcels,
    }
