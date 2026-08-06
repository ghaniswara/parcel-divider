"""Tests for the SLSQP optimizer (pee/optimizer.py)."""

import pytest

from pee.exceptions import OptimizationError
from pee.optimizer import OptimizeConfig, optimize
from tests.factories import make_rect_topology


def _mark_interior_movable(topo, min_off=-5.0, max_off=5.0):
    for e in topo.interior_edges():
        e.movable = True
        e.min_offset = min_off
        e.max_offset = max_off


class TestConvergence:
    def test_equal_lots_no_movement_needed(self):
        """Already-equal lots should converge with near-zero offsets."""
        topo = make_rect_topology([10, 10, 10])
        _mark_interior_movable(topo)
        result = optimize(topo)
        assert result.success
        assert result.max_area_error_pct < 0.5

    def test_unequal_lots_equalized(self):
        """80+140+80 m² → 100+100+100 m² within 0.5% error."""
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo)
        result = optimize(topo)
        assert result.success, f"Optimizer failed: {result.message}"
        assert result.max_area_error_pct < 0.5, (
            f"Max area error {result.max_area_error_pct:.4f}% > 0.5%"
        )
        for pid, area in result.parcel_areas.items():
            assert abs(area - 100.0) < 1.0, f"Parcel {pid}: area={area:.4f}"

    def test_five_lots(self):
        """Five lots with arbitrary widths converge to equal areas."""
        topo = make_rect_topology([5, 15, 8, 12, 10])
        _mark_interior_movable(topo, min_off=-10.0, max_off=10.0)
        result = optimize(topo)
        assert result.success
        assert result.max_area_error_pct < 0.5


class TestNoMovableEdges:
    def test_raises_optimization_error(self):
        topo = make_rect_topology([8, 14, 8])
        with pytest.raises(OptimizationError, match="No movable edges"):
            optimize(topo)


class TestCustomTargets:
    def test_explicit_target_areas(self):
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo, min_off=-10.0, max_off=10.0)
        targets = {0: 120.0, 1: 60.0, 2: 120.0}
        result = optimize(topo, OptimizeConfig(target_areas=targets))
        assert result.success
        for pid, target in targets.items():
            error_pct = abs(result.parcel_areas[pid] - target) / target * 100
            assert error_pct < 0.5, (
                f"Parcel {pid}: area={result.parcel_areas[pid]:.4f}, target={target}"
            )

    def test_weighted_areas(self):
        """2:1:1 weights → parcel 0 gets half the total area."""
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo, min_off=-15.0, max_off=15.0)
        result = optimize(topo, OptimizeConfig(weights={0: 2.0, 1: 1.0, 2: 1.0}))
        assert result.success
        assert abs(result.parcel_areas[0] / result.parcel_areas[1] - 2.0) < 0.05


class TestResultTopology:
    def test_updated_vertex_coords(self):
        """The result topology must have updated vertex positions."""
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo)
        result = optimize(topo)

        # All lots should now be ~10 wide.
        for pid in result.topology.parcels:
            coords = result.topology.get_parcel_coords(pid)
            xs = [c[0] for c in coords]
            width = max(xs) - min(xs)
            assert abs(width - 10.0) < 0.2, (
                f"Parcel {pid}: width={width:.4f}, expected≈10"
            )

    def test_iterations_positive(self):
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo)
        result = optimize(topo)
        assert result.iterations >= 1

    def test_offsets_returned(self):
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo)
        result = optimize(topo)
        assert len(result.final_offsets) == 2  # two interior edges
