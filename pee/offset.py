"""
Edge offset engine: applies edge offsets using the parallel-offset / sliding-endpoint rule.

Geometric model
---------------
When a movable edge E is given an offset δ, the engine shifts the *infinite
line* that contains E by δ units along the **left-hand normal** of the
canonical edge direction (v0 → v1).

The new positions of the shared vertices are found by computing the
intersection of *consecutive shifted lines* around each parcel ring.  This is
exactly the sliding-endpoint (parallel-offset) rule used in GIS parcel
adjustment: shared vertices slide along their neighbouring edges to meet the
new edge position — no gaps, no overlaps.

Sign convention
---------------
Positive δ moves the edge in the left-hand normal direction of (v0 → v1).

For a parcel on the LEFT of (v0 → v1):
  - positive δ shifts the edge *toward* the parcel → parcel area decreases
  - negative δ shifts the edge *away* from the parcel → parcel area increases

For a parcel on the RIGHT of (v0 → v1):
  - opposite effect (the parcel sees the reversed traversal)

Both neighbouring parcels use the *same* shifted line — consistency is
automatic.

Worked example (3-lot rectangular grid)
-----------------------------------------
Lots: 0=(0..8), 1=(8..22), 2=(22..30), height=10

Interior edge at x=8 (canonical v0=(8,0), v1=(8,10)):
  left-hand normal = (-1, 0) (pointing west)
  with δ=-2: edge shifts to x=10  →  lot 0 grows, lot 1 shrinks
  with δ=+2: edge shifts to x=6   →  lot 0 shrinks, lot 1 grows
"""

from __future__ import annotations

import math

from pee.model import Parcel, Topology


def apply_offsets(
    topology: Topology,
    offsets: dict[int, float],
) -> dict[int, list[tuple[float, float]]]:
    """
    Apply edge offsets to the topology and return updated parcel ring coordinates.

    Parameters
    ----------
    topology : Topology
        The current topology.
    offsets : dict[edge_id → delta]
        Signed offsets for movable edges (in CRS units).  Edges absent from
        this dict are treated as δ = 0.

    Returns
    -------
    dict[parcel_id → list of (x, y)]
        Updated **open** ring coordinates for every parcel.
    """
    return {
        parcel_id: _compute_parcel_coords(topology, parcel, offsets)
        for parcel_id, parcel in topology.parcels.items()
    }


def _compute_parcel_coords(
    topology: Topology,
    parcel: Parcel,
    offsets: dict[int, float],
) -> list[tuple[float, float]]:
    """Compute new ring coordinates for one parcel given edge offsets."""
    n = len(parcel.vertex_ids)

    # Step 1 — Compute the shifted line equation for every ring edge.
    lines: list[tuple[float, float, float]] = []
    for i in range(n):
        v0_id_ring = parcel.vertex_ids[i]
        v1_id_ring = parcel.vertex_ids[(i + 1) % n]
        edge_id = parcel.edge_ids[i]
        edge = topology.edges[edge_id]

        v0_ring = topology.vertices[v0_id_ring]
        v1_ring = topology.vertices[v1_id_ring]

        delta = offsets.get(edge_id, 0.0)

        # Sign correction: if this parcel traverses the edge in the *reversed*
        # direction (right parcel), negate δ so that _shifted_line — which
        # always uses the left-hand normal of the *given* direction — produces
        # the same absolute line position as for the left parcel.
        sign = 1.0 if (edge.v0_id == v0_id_ring) else -1.0
        signed_delta = sign * delta

        lines.append(_shifted_line(v0_ring.coords(), v1_ring.coords(), signed_delta))

    # Step 2 — New vertices = intersections of consecutive edge lines.
    new_coords: list[tuple[float, float]] = []
    for i in range(n):
        prev_line = lines[(i - 1) % n]
        curr_line = lines[i]
        new_coords.append(_intersect_lines(prev_line, curr_line))

    return new_coords


def _shifted_line(
    p0: tuple[float, float],
    p1: tuple[float, float],
    delta: float,
) -> tuple[float, float, float]:
    """
    Return the line equation ``(a, b, c)`` with ``a·x + b·y = c`` for the edge
    *p0→p1* shifted by *delta* units along its **left-hand normal**.

    Derivation
    ----------
    Direction vector:  d = (dx, dy) = p1 - p0
    Left-hand normal (unnormalised):  n = (-dy, dx)  →  length |n| = |d|

    Original line:  n · p = n · p0   ⟹   a·x + b·y = c₀
      where a = -dy,  b = dx,  c₀ = a·x₀ + b·y₀

    Shifting by delta along the **unit** left-hand normal moves c₀ by
    delta × |n|  (because the unit normal has magnitude 1 and c is scaled
    by |n|):

        c_new = c₀ + delta × |d|
    """
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]

    a = -dy
    b = dx
    c0 = a * p0[0] + b * p0[1]
    length = math.sqrt(a * a + b * b)

    if length < 1e-12:
        raise ValueError(
            f"Degenerate (zero-length) edge between {p0} and {p1}."
        )

    return (a, b, c0 + delta * length)


def _intersect_lines(
    l1: tuple[float, float, float],
    l2: tuple[float, float, float],
) -> tuple[float, float]:
    """
    Return the intersection point of two lines given as (a, b, c) with a·x + b·y = c.

    Raises
    ------
    ValueError
        If the lines are parallel or coincident.
    """
    a1, b1, c1 = l1
    a2, b2, c2 = l2

    det = a1 * b2 - a2 * b1
    if abs(det) < 1e-12:
        raise ValueError(
            f"Lines are parallel or coincident: {l1!r} ∩ {l2!r}"
        )

    x = (c1 * b2 - c2 * b1) / det
    y = (a1 * c2 - a2 * c1) / det
    return (x, y)
