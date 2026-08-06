"""Public API for the Parcel Equalization Engine."""

from __future__ import annotations

from pee.export import to_geojson
from pee.loader import EdgeConfig, configure_movable_edges, load_geojson
from pee.optimizer import OptimizeConfig, OptimizeResult, optimize
from pee.validator import validate

__all__ = [
    "equalize",
    "EdgeConfig",
    "OptimizeConfig",
]


def equalize(
    geojson: dict,
    *,
    movable_edges: list[EdgeConfig] | None = None,
    all_interior_movable: bool = False,
    target_areas: dict[int, float] | None = None,
    weights: dict[int, float] | None = None,
    max_iter: int = 200,
    tol: float = 1e-8,
    validate_output: bool = True,
) -> dict:
    """
    Equalize parcel areas by adjusting movable edge positions.

    Parameters
    ----------
    geojson : dict
        Input geometry.  Either the internal format
        ``{"outer": ..., "parcels": [...]}`` or a GeoJSON FeatureCollection
        where parcel features have ``properties.role = "parcel"`` and the
        outer boundary has ``properties.role = "outer"``.
    movable_edges : list of :class:`~pee.loader.EdgeConfig`, optional
        Explicit per-edge configuration (endpoint coordinates + offset bounds).
        If *all_interior_movable* is True this is applied **after** marking all
        interior edges movable, allowing individual bounds to be tightened.
    all_interior_movable : bool
        Convenience flag.  When True, every interior (shared) edge is marked
        movable with unconstrained bounds (±∞).
    target_areas : dict[parcel_id → area], optional
        Absolute target area for each parcel.  Overrides *weights*.
    weights : dict[parcel_id → weight], optional
        Relative target-area weights.  Ignored when *target_areas* is given.
        If both are None, equal areas are used.
    max_iter : int
        Maximum SLSQP iterations.
    tol : float
        Optimizer convergence tolerance on the objective value.
    validate_output : bool
        Run the geometry validator before returning.  Raises
        :class:`~pee.exceptions.ValidationError` if the result is invalid.

    Returns
    -------
    dict
        GeoJSON FeatureCollection with optimized parcel geometries and a
        ``"stats"`` block.

    Raises
    ------
    pee.exceptions.LoaderError
        On malformed input geometry.
    pee.exceptions.OptimizationError
        If no movable edges are defined.
    pee.exceptions.ValidationError
        If the optimized geometry fails geometry checks (*validate_output* must
        be True).
    """
    topology = load_geojson(geojson)

    if all_interior_movable:
        for edge in topology.edges.values():
            if edge.is_interior:
                edge.movable = True
                edge.min_offset = -1e9
                edge.max_offset = 1e9

    if movable_edges:
        configure_movable_edges(topology, movable_edges)

    config = OptimizeConfig(
        target_areas=target_areas,
        weights=weights,
        max_iter=max_iter,
        tol=tol,
    )

    result = optimize(topology, config)

    if validate_output:
        validate(result.topology)

    return to_geojson(result)
