"""Post-optimization geometry validator."""

from __future__ import annotations

from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.validation import explain_validity

from pee.exceptions import ValidationError
from pee.model import Topology


def validate(topology: Topology, tol: float = 1e-4) -> None:
    """
    Validate the topology's geometry after optimization.

    Checks (in order)
    -----------------
    1. Every parcel polygon is valid (no self-intersections, closed ring,
       positive area).
    2. No pairwise overlaps (intersection area < *tol*).
    3. No gaps: union of all parcels equals the outer boundary (within *tol*).
    4. No parcels extending beyond the outer boundary (within *tol*).

    Parameters
    ----------
    topology : Topology
    tol : float
        Tolerance for area-based gap/overlap checks (CRS units²).

    Raises
    ------
    ValidationError
        With a descriptive message on the first check that fails.
    """
    parcel_polys: dict[int, Polygon] = {}

    # ------------------------------------------------------------------ #
    # 1. Individual polygon validity                                       #
    # ------------------------------------------------------------------ #
    for parcel_id in topology.parcels:
        coords = topology.get_parcel_coords(parcel_id)
        ring = coords + [coords[0]]
        poly = Polygon(ring)

        if not poly.is_valid:
            raise ValidationError(
                f"Parcel {parcel_id} has invalid geometry: {explain_validity(poly)}"
            )
        if poly.area < tol:
            raise ValidationError(
                f"Parcel {parcel_id} has near-zero or negative area: {poly.area:.6g}"
            )

        parcel_polys[parcel_id] = poly

    # ------------------------------------------------------------------ #
    # 2. Pairwise overlap check                                           #
    # ------------------------------------------------------------------ #
    ids = list(parcel_polys.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            overlap_area = parcel_polys[ids[i]].intersection(parcel_polys[ids[j]]).area
            if overlap_area > tol:
                raise ValidationError(
                    f"Parcels {ids[i]} and {ids[j]} overlap by "
                    f"{overlap_area:.6g} units²."
                )

    # ------------------------------------------------------------------ #
    # 3 & 4. Gap and boundary-exceedance check                           #
    # ------------------------------------------------------------------ #
    if topology.outer is not None:
        outer_ring = topology.outer + [topology.outer[0]]
        outer_poly = Polygon(outer_ring)
        union_poly = unary_union(list(parcel_polys.values()))

        gap_area = outer_poly.difference(union_poly).area
        if gap_area > tol:
            raise ValidationError(
                f"Gaps found between parcels: total gap area = {gap_area:.6g} units²."
            )

        extra_area = union_poly.difference(outer_poly).area
        if extra_area > tol:
            raise ValidationError(
                f"Parcels extend outside the outer boundary by "
                f"{extra_area:.6g} units²."
            )
