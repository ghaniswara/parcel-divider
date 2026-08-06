"""
Domain model: Vertex, Edge, Parcel, Topology.

Design notes
------------
- Shared edges are stored once; left/right parcel assignment encodes which
  parcel traverses the edge in canonical (v0→v1) vs. reversed (v1→v0) direction.
- left_parcel_id: parcel whose CCW ring traverses the edge as v0→v1.
- right_parcel_id: parcel whose CCW ring traverses the edge as v1→v0.
- A CCW ring keeps the polygon interior to the LEFT of each directed edge,
  so the left parcel is the one that owns the interior on the left of v0→v1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Vertex:
    """A 2-D point in the topology graph."""

    id: int
    x: float
    y: float

    def coords(self) -> tuple[float, float]:
        """Return (x, y) tuple."""
        return (self.x, self.y)


@dataclass
class Edge:
    """
    A directed edge between two vertices, shared between at most two parcels.

    The canonical direction is v0 → v1.  A positive offset moves the edge
    along the LEFT-HAND normal of the canonical direction.
    """

    id: int
    v0_id: int  # start vertex (canonical direction)
    v1_id: int  # end vertex (canonical direction)
    left_parcel_id: Optional[int] = None   # parcel traversing v0 → v1
    right_parcel_id: Optional[int] = None  # parcel traversing v1 → v0
    movable: bool = False
    min_offset: float = -5.0
    max_offset: float = 5.0

    @property
    def is_interior(self) -> bool:
        """True if this edge is shared between two parcels."""
        return self.left_parcel_id is not None and self.right_parcel_id is not None

    @property
    def is_exterior(self) -> bool:
        """True if this edge borders only one parcel (outer boundary)."""
        return not self.is_interior


@dataclass
class Parcel:
    """A polygon parcel defined by an ordered ring of vertices and edges."""

    id: int
    # Open ring: vertex_ids[i] → vertex_ids[(i+1) % n], closed implicitly.
    vertex_ids: list[int] = field(default_factory=list)
    # edge_ids[i] is the edge connecting vertex_ids[i] to vertex_ids[(i+1) % n].
    edge_ids: list[int] = field(default_factory=list)


@dataclass
class Topology:
    """The complete topology graph for a subdivided parcel."""

    vertices: dict[int, Vertex] = field(default_factory=dict)
    edges: dict[int, Edge] = field(default_factory=dict)
    parcels: dict[int, Parcel] = field(default_factory=dict)
    # Open exterior boundary ring (closing coord dropped), may be None.
    outer: Optional[list[tuple[float, float]]] = None

    # ------------------------------------------------------------------
    # Convenience accessors
    # ------------------------------------------------------------------

    def get_parcel_coords(self, parcel_id: int) -> list[tuple[float, float]]:
        """Return the open ring of (x, y) coordinates for a parcel."""
        parcel = self.parcels[parcel_id]
        return [(self.vertices[vid].x, self.vertices[vid].y) for vid in parcel.vertex_ids]

    def movable_edges(self) -> list[Edge]:
        """Return all edges marked as movable."""
        return [e for e in self.edges.values() if e.movable]

    def interior_edges(self) -> list[Edge]:
        """Return all edges shared between two parcels."""
        return [e for e in self.edges.values() if e.is_interior]
