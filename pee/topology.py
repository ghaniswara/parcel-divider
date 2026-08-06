"""
Topology builder: converts Shapely polygons into a Topology graph.

Algorithm
---------
1. Snap all coordinates to COORD_PRECISION decimal places to merge vertices
   that are geometrically identical but differ by floating-point noise.
2. Assign monotonically increasing integer IDs to unique (snapped) vertices.
3. For each parcel polygon (exterior ring, CCW), traverse consecutive vertex
   pairs and look up or create an Edge record.
4. The first parcel to create an edge becomes its *left* parcel (traversal in
   canonical v0→v1 direction).  The second parcel traverses it in reverse and
   becomes the *right* parcel.

Left / right convention
-----------------------
A CCW ring keeps the polygon interior to the LEFT of each directed edge.
Therefore, for edge (v0→v1):
  - left_parcel  = the parcel whose ring traverses v0→v1  (interior to the left)
  - right_parcel = the parcel whose ring traverses v1→v0  (interior to the right
                   of the *canonical* direction, i.e., the left of the reversed
                   direction)
"""

from __future__ import annotations

from shapely.geometry import Polygon

from pee.exceptions import TopologyError
from pee.model import Edge, Parcel, Topology, Vertex

# Round coordinates to this many decimal places for vertex de-duplication.
# Eight decimal places ≈ 1 mm precision in degree-based CRS, sub-micron in metres.
COORD_PRECISION: int = 8


def _snap(x: float, y: float) -> tuple[float, float]:
    """Return the (x, y) pair rounded to COORD_PRECISION decimal places."""
    return (round(x, COORD_PRECISION), round(y, COORD_PRECISION))


def build_topology(outer: Polygon, parcels: list[Polygon]) -> Topology:
    """
    Build a Topology from a Shapely outer polygon and a list of Shapely parcel polygons.

    Parameters
    ----------
    outer : Polygon
        The exterior boundary of the entire subdivision.
    parcels : list of Polygon
        Interior parcel polygons.  They must partition *outer* with no gaps or
        overlaps (this is not validated here; use the validator module).

    Returns
    -------
    Topology

    Raises
    ------
    TopologyError
        If any parcel has invalid geometry or if an edge is claimed by more
        than two parcels.
    """
    # ------------------------------------------------------------------ #
    # Pass 1 – collect all unique vertices                                #
    # ------------------------------------------------------------------ #
    vertex_id_map: dict[tuple[float, float], int] = {}
    vertices: dict[int, Vertex] = {}

    def get_or_create_vertex(x: float, y: float) -> int:
        key = _snap(x, y)
        if key not in vertex_id_map:
            vid = len(vertex_id_map)
            vertex_id_map[key] = vid
            vertices[vid] = Vertex(id=vid, x=key[0], y=key[1])
        return vertex_id_map[key]

    # ------------------------------------------------------------------ #
    # Pass 2 – build edges and parcels                                    #
    # ------------------------------------------------------------------ #
    # Normalised edge key: (min_vid, max_vid) so that forward and reversed
    # traversal hash to the same slot.
    edge_key_map: dict[tuple[int, int], Edge] = {}
    edges: dict[int, Edge] = {}
    pee_parcels: dict[int, Parcel] = {}

    for parcel_idx, poly in enumerate(parcels):
        if not poly.is_valid:
            raise TopologyError(
                f"Parcel {parcel_idx} has invalid geometry: {poly.is_valid}"
            )

        # exterior.coords includes the closing duplicate; drop it.
        ring_coords = list(poly.exterior.coords)[:-1]
        n = len(ring_coords)

        # Collect vertex IDs for this ring.
        vertex_ids: list[int] = [
            get_or_create_vertex(x, y) for x, y in ring_coords
        ]

        edge_ids: list[int] = []
        for i in range(n):
            v0_id = vertex_ids[i]
            v1_id = vertex_ids[(i + 1) % n]

            # Normalised key (direction-independent).
            norm_key = (min(v0_id, v1_id), max(v0_id, v1_id))

            if norm_key not in edge_key_map:
                eid = len(edge_key_map)
                edge = Edge(id=eid, v0_id=v0_id, v1_id=v1_id)
                edge_key_map[norm_key] = edge
                edges[eid] = edge
            else:
                edge = edge_key_map[norm_key]

            # Assign parcel to left or right side based on traversal direction.
            if edge.v0_id == v0_id:
                # Forward traversal (v0→v1) → this parcel is on the LEFT.
                if edge.left_parcel_id is not None:
                    raise TopologyError(
                        f"Edge {edge.id} ({edge.v0_id}→{edge.v1_id}) already has a "
                        f"left parcel ({edge.left_parcel_id}); cannot also assign "
                        f"parcel {parcel_idx}.  Input may have overlapping polygons."
                    )
                edge.left_parcel_id = parcel_idx
            else:
                # Reversed traversal (v1→v0) → this parcel is on the RIGHT.
                if edge.right_parcel_id is not None:
                    raise TopologyError(
                        f"Edge {edge.id} ({edge.v0_id}→{edge.v1_id}) already has a "
                        f"right parcel ({edge.right_parcel_id}); cannot also assign "
                        f"parcel {parcel_idx}.  Input may have overlapping polygons."
                    )
                edge.right_parcel_id = parcel_idx

            edge_ids.append(edge.id)

        pee_parcels[parcel_idx] = Parcel(
            id=parcel_idx,
            vertex_ids=vertex_ids,
            edge_ids=edge_ids,
        )

    # ------------------------------------------------------------------ #
    # Outer ring                                                          #
    # ------------------------------------------------------------------ #
    outer_coords = [_snap(x, y) for x, y in list(outer.exterior.coords)[:-1]]

    return Topology(
        vertices=vertices,
        edges=edges,
        parcels=pee_parcels,
        outer=outer_coords,
    )
