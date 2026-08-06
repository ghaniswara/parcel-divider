"""Tests for area calculation (pee/area.py)."""

from pee.area import compute_areas, compute_target_areas
from tests.factories import make_rect_topology


class TestComputeAreas:
    def test_equal_lots(self):
        topo = make_rect_topology([10, 10, 10])
        areas = compute_areas(topo)
        for pid, area in areas.items():
            assert abs(area - 100.0) < 1e-8, f"Parcel {pid}: expected 100, got {area}"

    def test_unequal_lots(self):
        topo = make_rect_topology([8, 14, 8])
        areas = compute_areas(topo)
        assert abs(areas[0] - 80.0) < 1e-8
        assert abs(areas[1] - 140.0) < 1e-8
        assert abs(areas[2] - 80.0) < 1e-8

    def test_total_area_conserved(self):
        topo = make_rect_topology([8, 14, 8])
        assert abs(sum(compute_areas(topo).values()) - 300.0) < 1e-8

    def test_coords_override(self):
        """coords_override should replace topology vertex positions."""
        topo = make_rect_topology([8, 14, 8])
        # Override lot 0 to be 10×10
        override = {0: [(0, 0), (10, 0), (10, 10), (0, 10)]}
        areas = compute_areas(topo, coords_override=override)
        assert abs(areas[0] - 100.0) < 1e-8
        # Other lots unchanged
        assert abs(areas[1] - 140.0) < 1e-8


class TestTargetAreas:
    def test_equal_target(self):
        topo = make_rect_topology([8, 14, 8])
        targets = compute_target_areas(topo)
        for pid, t in targets.items():
            assert abs(t - 100.0) < 1e-8

    def test_weighted_targets_sum_to_total(self):
        topo = make_rect_topology([8, 14, 8])
        weights = {0: 1.0, 1: 2.0, 2: 1.0}
        targets = compute_target_areas(topo, weights)
        assert abs(sum(targets.values()) - 300.0) < 1e-8

    def test_weighted_targets_ratio(self):
        topo = make_rect_topology([8, 14, 8])
        weights = {0: 1.0, 1: 2.0, 2: 1.0}
        targets = compute_target_areas(topo, weights)
        # Parcel 1 gets double the area of parcels 0 and 2
        assert abs(targets[1] / targets[0] - 2.0) < 1e-8

    def test_equal_weights_same_as_none(self):
        topo = make_rect_topology([8, 14, 8])
        t_none = compute_target_areas(topo, None)
        t_equal = compute_target_areas(topo, {0: 1.0, 1: 1.0, 2: 1.0})
        for pid in topo.parcels:
            assert abs(t_none[pid] - t_equal[pid]) < 1e-8
