"""Area calculations for parcels."""

from __future__ import annotations

from shapely.geometry import Polygon

from pee.model import Topology


def compute_areas(
    topology: Topology,
    coords_override: dict[int, list[tuple[float, float]]] | None = None,
) -> dict[int, float]:
    """
    Compute the area of each parcel using Shapely (Shoelace formula internally).

    Parameters
    ----------
    topology : Topology
    coords_override : dict[parcel_id → open ring coords], optional
        If provided, use these coordinates instead of the topology's stored
        vertex positions.  Used by the optimizer to evaluate candidate offsets
        without mutating the topology.

    Returns
    -------
    dict[parcel_id → area]
    """
    result: dict[int, float] = {}
    for parcel_id in topology.parcels:
        if coords_override and parcel_id in coords_override:
            coords = coords_override[parcel_id]
        else:
            coords = topology.get_parcel_coords(parcel_id)

        # Close the ring for Shapely.
        ring = coords + [coords[0]]
        result[parcel_id] = Polygon(ring).area

    return result


def compute_target_areas(
    topology: Topology,
    weights: dict[int, float] | None = None,
) -> dict[int, float]:
    """
    Compute the target area for each parcel.

    Parameters
    ----------
    topology : Topology
    weights : dict[parcel_id → weight], optional
        Relative target-area weights.  If *None*, equal weights are used so
        every parcel gets ``total_area / n``.  Weights are normalised
        internally, so they don't need to sum to any particular value.

    Returns
    -------
    dict[parcel_id → target_area]
    """
    total_area = sum(compute_areas(topology).values())
    parcel_ids = list(topology.parcels.keys())
    n = len(parcel_ids)

    if weights is None:
        equal = total_area / n
        return {pid: equal for pid in parcel_ids}

    total_weight = sum(weights.get(pid, 1.0) for pid in parcel_ids)
    if total_weight <= 0:
        raise ValueError("Sum of weights must be positive.")

    return {
        pid: total_area * weights.get(pid, 1.0) / total_weight
        for pid in parcel_ids
    }
