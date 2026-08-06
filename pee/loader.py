"""
Geometry loader: parses GeoJSON / WKT into Shapely objects and builds a Topology.

Supported input formats
-----------------------
1. Internal JSON::

       {
           "outer":   <GeoJSON Polygon geometry>,
           "parcels": [<GeoJSON Polygon geometry>, ...]
       }

2. GeoJSON FeatureCollection with ``"role"`` property::

       {
           "type": "FeatureCollection",
           "features": [
               {"type": "Feature", "properties": {"role": "outer"}, "geometry": {...}},
               {"type": "Feature", "properties": {"role": "parcel"}, "geometry": {...}},
               ...
           ]
       }

3. WKT via :func:`load_wkt`.

Edge configuration
------------------
:class:`EdgeConfig` identifies a movable edge by its two endpoint coordinates.
Use :func:`configure_movable_edges` after loading to mark edges as movable.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import Polygon, shape
from shapely.wkt import loads as wkt_loads

from pee.exceptions import LoaderError
from pee.model import Topology
from pee.topology import _snap, build_topology


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------


def load_geojson(data: dict) -> Topology:
    """
    Parse GeoJSON (internal format or FeatureCollection) into a Topology.

    Raises
    ------
    LoaderError
        On unrecognised format, missing keys, or non-Polygon geometries.
    """
    try:
        if data.get("type") == "FeatureCollection":
            return _load_feature_collection(data)
        if "outer" in data and "parcels" in data:
            return _load_internal_format(data)
        raise LoaderError(
            "Unrecognised GeoJSON format. Expected a FeatureCollection or "
            '{"outer": ..., "parcels": [...]}.'
        )
    except LoaderError:
        raise
    except Exception as exc:
        raise LoaderError(f"Failed to parse GeoJSON: {exc}") from exc


def load_wkt(outer_wkt: str, parcel_wkts: list[str]) -> Topology:
    """
    Parse WKT strings into a Topology.

    Parameters
    ----------
    outer_wkt : str
        WKT representation of the outer boundary Polygon.
    parcel_wkts : list of str
        WKT representation of each parcel Polygon.

    Raises
    ------
    LoaderError
        On parse errors or non-Polygon geometries.
    """
    try:
        outer = wkt_loads(outer_wkt)
        if not isinstance(outer, Polygon):
            raise LoaderError("outer_wkt must be a Polygon WKT string.")
        parcel_geoms: list[Polygon] = []
        for i, wkt in enumerate(parcel_wkts):
            geom = wkt_loads(wkt)
            if not isinstance(geom, Polygon):
                raise LoaderError(f"parcel_wkts[{i}] must be a Polygon WKT string.")
            parcel_geoms.append(geom)
        return build_topology(outer, parcel_geoms)
    except LoaderError:
        raise
    except Exception as exc:
        raise LoaderError(f"Failed to parse WKT: {exc}") from exc


# ---------------------------------------------------------------------------
# Edge configuration
# ---------------------------------------------------------------------------


@dataclass
class EdgeConfig:
    """
    Configuration for a single movable edge, identified by its endpoint coordinates.

    Parameters
    ----------
    v0 : (x, y)
        First endpoint of the edge (order does not matter for lookup).
    v1 : (x, y)
        Second endpoint of the edge.
    movable : bool
        Whether the edge is allowed to move.
    min_offset : float
        Minimum offset (in CRS units) along the edge's left-hand normal.
    max_offset : float
        Maximum offset (in CRS units) along the edge's left-hand normal.
    """

    v0: tuple[float, float]
    v1: tuple[float, float]
    movable: bool = True
    min_offset: float = -5.0
    max_offset: float = 5.0


def configure_movable_edges(topology: Topology, configs: list[EdgeConfig]) -> None:
    """
    Mark edges as movable based on endpoint coordinate matching.

    Mutates *topology* in place.

    Raises
    ------
    LoaderError
        If any endpoint coordinate in *configs* does not match a topology vertex,
        or if no edge connects the two endpoints.
    """
    # Build coordinate → vertex_id lookup.
    coord_to_vid: dict[tuple[float, float], int] = {
        _snap(v.x, v.y): vid for vid, v in topology.vertices.items()
    }

    # Build endpoint pair → Edge lookup (both directions).
    endpoint_to_edge: dict[tuple[int, int], Edge] = {}
    for edge in topology.edges.values():
        endpoint_to_edge[(edge.v0_id, edge.v1_id)] = edge
        endpoint_to_edge[(edge.v1_id, edge.v0_id)] = edge

    for cfg in configs:
        v0_key = _snap(*cfg.v0)
        v1_key = _snap(*cfg.v1)

        v0_id = coord_to_vid.get(v0_key)
        v1_id = coord_to_vid.get(v1_key)

        if v0_id is None:
            raise LoaderError(
                f"EdgeConfig v0={cfg.v0} does not match any vertex in the topology."
            )
        if v1_id is None:
            raise LoaderError(
                f"EdgeConfig v1={cfg.v1} does not match any vertex in the topology."
            )

        edge = endpoint_to_edge.get((v0_id, v1_id))
        if edge is None:
            raise LoaderError(
                f"No edge found between {cfg.v0} and {cfg.v1} in the topology."
            )

        edge.movable = cfg.movable
        edge.min_offset = cfg.min_offset
        edge.max_offset = cfg.max_offset


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _load_internal_format(data: dict) -> Topology:
    outer_geom = shape(data["outer"])
    if not isinstance(outer_geom, Polygon):
        raise LoaderError('"outer" must be a GeoJSON Polygon geometry.')

    parcel_geoms: list[Polygon] = []
    for i, p in enumerate(data["parcels"]):
        geom = shape(p)
        if not isinstance(geom, Polygon):
            raise LoaderError(f'"parcels[{i}]" must be a GeoJSON Polygon geometry.')
        parcel_geoms.append(geom)

    if not parcel_geoms:
        raise LoaderError('"parcels" must contain at least one polygon.')

    return build_topology(outer_geom, parcel_geoms)


def _load_feature_collection(data: dict) -> Topology:
    outer_geom: Polygon | None = None
    parcel_geoms: list[Polygon] = []

    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        geom = shape(feature["geometry"])
        role = props.get("role", "parcel")

        if role == "outer":
            if not isinstance(geom, Polygon):
                raise LoaderError('The "outer" feature must be a Polygon geometry.')
            outer_geom = geom
        else:
            if not isinstance(geom, Polygon):
                raise LoaderError("All parcel features must be Polygon geometries.")
            parcel_geoms.append(geom)

    if outer_geom is None:
        raise LoaderError(
            'FeatureCollection must contain a feature with properties.role = "outer".'
        )
    if not parcel_geoms:
        raise LoaderError(
            "FeatureCollection must contain at least one parcel feature."
        )

    return build_topology(outer_geom, parcel_geoms)


# Re-export Edge so callers importing from loader get the type.
from pee.model import Edge  # noqa: E402  (circular-safe: model has no deps)
