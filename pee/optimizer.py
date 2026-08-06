"""
SLSQP-based optimizer for parcel area equalization.

Optimization formulation
------------------------
Variables:   x[i] = offset of movable edge i  (one float per movable edge)
Bounds:      edge.min_offset ≤ x[i] ≤ edge.max_offset
Objective:   minimize  Σ_i (area_i(x) − target_i)²

The area of each parcel is a nonlinear (quadratic) function of the offsets,
so we use SciPy's SLSQP solver which handles nonlinear objectives natively.
Gradients are approximated by finite differences.

Convergence is typically achieved in < 30 iterations for residential-scale
subdivisions (≤ 20 parcels, all straight edges).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize
from shapely.geometry import Point, Polygon

from pee.area import compute_target_areas
from pee.exceptions import OptimizationError
from pee.model import Topology, Vertex
from pee.offset import apply_offsets


# ---------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------


@dataclass
class OptimizeConfig:
    """Configuration for the SLSQP optimizer."""

    # Target areas for each parcel by ID.  None = equal split.
    target_areas: dict[int, float] | None = None
    # Alternative to target_areas: relative weights (normalised internally).
    weights: dict[int, float] | None = None
    # Maximum number of SLSQP iterations.
    max_iter: int = 200
    # Convergence tolerance on the objective function value.
    tol: float = 1e-8
    # Step size for finite-difference gradient approximation.
    finite_diff_step: float = 1e-6


@dataclass
class OptimizeResult:
    """Result of a single optimization run."""

    success: bool
    iterations: int
    max_area_error_pct: float
    final_offsets: dict[int, float]
    topology: Topology            # Updated topology with new vertex positions.
    parcel_areas: dict[int, float]
    target_areas: dict[int, float]
    message: str


# ---------------------------------------------------------------------------
# Optimizer
# ---------------------------------------------------------------------------


def optimize(
    topology: Topology,
    config: OptimizeConfig | None = None,
) -> OptimizeResult:
    """
    Run the SLSQP optimizer to equalize parcel areas.

    Parameters
    ----------
    topology : Topology
        Input topology.  At least one edge must be marked ``movable=True``.
    config : OptimizeConfig, optional
        Solver settings.  Defaults to equal-area split with standard tolerances.

    Returns
    -------
    OptimizeResult

    Raises
    ------
    OptimizationError
        If no movable edges are defined.
    """
    if config is None:
        config = OptimizeConfig()

    movable = topology.movable_edges()
    if not movable:
        raise OptimizationError(
            "No movable edges defined.  Mark at least one interior edge as "
            "movable before calling optimize()."
        )

    edge_ids = [e.id for e in movable]
    bounds = [(e.min_offset, e.max_offset) for e in movable]
    parcel_ids = list(topology.parcels.keys())

    # Determine target areas.
    if config.target_areas is not None:
        targets = config.target_areas
    else:
        targets = compute_target_areas(topology, config.weights)

    # ------------------------------------------------------------------ #
    # Objective function                                                   #
    # ------------------------------------------------------------------ #
    def objective(x: np.ndarray) -> float:
        offsets = {eid: float(x[i]) for i, eid in enumerate(edge_ids)}
        coords = apply_offsets(topology, offsets)
        sq_err = 0.0
        for pid in parcel_ids:
            ring = coords[pid] + [coords[pid][0]]
            area = Polygon(ring).area
            sq_err += (area - targets[pid]) ** 2
        return sq_err

    # ------------------------------------------------------------------ #
    # Constraints                                                          #
    # ------------------------------------------------------------------ #
    constraints = []
    if topology.outer:
        outer_poly = Polygon(topology.outer)
        
        def boundary_constraint(x: np.ndarray) -> np.ndarray:
            offsets = {eid: float(x[i]) for i, eid in enumerate(edge_ids)}
            coords = apply_offsets(topology, offsets)
            
            dists = []
            for pid in parcel_ids:
                for pt in coords[pid]:
                    p = Point(*pt)
                    dist = outer_poly.exterior.distance(p)
                    if outer_poly.covers(p):
                        dists.append(dist)
                    else:
                        dists.append(-dist)
            return np.array(dists)
            
        constraints.append({'type': 'ineq', 'fun': boundary_constraint})

    x0 = np.zeros(len(edge_ids))

    # ------------------------------------------------------------------ #
    # Run SLSQP                                                            #
    # ------------------------------------------------------------------ #
    scipy_result = minimize(
        objective,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={
            "maxiter": config.max_iter,
            "ftol": config.tol,
            "eps": config.finite_diff_step,
        },
    )

    # ------------------------------------------------------------------ #
    # Post-process                                                         #
    # ------------------------------------------------------------------ #
    final_offsets = {eid: float(scipy_result.x[i]) for i, eid in enumerate(edge_ids)}
    final_coords = apply_offsets(topology, final_offsets)

    final_areas: dict[int, float] = {}
    for pid in parcel_ids:
        ring = final_coords[pid] + [final_coords[pid][0]]
        final_areas[pid] = Polygon(ring).area

    max_error_pct = max(
        abs(final_areas[pid] - targets[pid]) / targets[pid] * 100
        for pid in parcel_ids
        if targets[pid] > 0
    )

    updated_topology = _apply_coords_to_topology(topology, final_coords)

    return OptimizeResult(
        success=bool(scipy_result.success),
        iterations=int(scipy_result.nit),
        max_area_error_pct=max_error_pct,
        final_offsets=final_offsets,
        topology=updated_topology,
        parcel_areas=final_areas,
        target_areas=targets,
        message=str(scipy_result.message),
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _apply_coords_to_topology(
    topology: Topology,
    coords: dict[int, list[tuple[float, float]]],
) -> Topology:
    """
    Return a new Topology with vertex positions updated from *coords*.

    Shared vertices are written multiple times (once per parcel that references
    them) but always to the same coordinates — the parallel-offset rule
    guarantees exact agreement between neighbouring parcels.
    """
    new_vertices: dict[int, Vertex] = {
        vid: Vertex(id=vid, x=v.x, y=v.y)
        for vid, v in topology.vertices.items()
    }

    for parcel_id, ring_coords in coords.items():
        parcel = topology.parcels[parcel_id]
        for i, (x, y) in enumerate(ring_coords):
            vid = parcel.vertex_ids[i]
            new_vertices[vid] = Vertex(id=vid, x=x, y=y)

    return Topology(
        vertices=new_vertices,
        edges=topology.edges,
        parcels=topology.parcels,
        outer=topology.outer,
    )
