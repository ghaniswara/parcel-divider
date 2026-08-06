"""Tests for the edge offset engine (pee/offset.py)."""

import math

import pytest
from shapely.geometry import Polygon

from pee.area import compute_areas
from pee.offset import _intersect_lines, _shifted_line, apply_offsets
from tests.factories import make_rect_topology


class TestShiftedLine:
    def test_horizontal_edge_shifted_up(self):
        """Horizontal edge (0,0)→(10,0) with δ=1 should yield y=1."""
        a, b, c = _shifted_line((0, 0), (10, 0), 1.0)
        # Expected: a=0, b=10, c=10  →  10y = 10  →  y = 1
        assert abs(a) < 1e-10
        assert abs(b - 10) < 1e-10
        assert abs(c - 10) < 1e-10

    def test_vertical_edge_shifted_left(self):
        """Vertical edge (8,0)→(8,10) with δ=1 shifts left (x = 7)."""
        a, b, c = _shifted_line((8, 0), (8, 10), 1.0)
        # direction (0,10): a=-10, b=0, c=-80, |d|=10
        # c_shifted = -80 + 1*10 = -70 → -10x = -70 → x = 7
        assert abs(a - (-10)) < 1e-10
        assert abs(b) < 1e-10
        assert abs(c - (-70)) < 1e-10

    def test_diagonal_edge(self):
        """Check the general formula for a 3-4-5 edge."""
        # Edge (0,0)→(3,4), |d|=5, left normal=(-4,3)/5
        a, b, c = _shifted_line((0, 0), (3, 4), 1.0)
        assert abs(a - (-4)) < 1e-10
        assert abs(b - 3) < 1e-10
        # c_shifted = 0 + 1*5 = 5
        assert abs(c - 5) < 1e-10

    def test_degenerate_edge_raises(self):
        with pytest.raises(ValueError, match="Degenerate"):
            _shifted_line((5, 5), (5, 5), 1.0)


class TestIntersectLines:
    def test_horizontal_vertical_intersection(self):
        """y=3 ∩ x=7 → (7, 3)."""
        # y=3: 0x+1y=3 (a=0, b=1, c=3)
        # x=7: 1x+0y=7 (a=1, b=0, c=7)
        x, y = _intersect_lines((0, 1, 3), (1, 0, 7))
        assert abs(x - 7) < 1e-8
        assert abs(y - 3) < 1e-8

    def test_parallel_lines_raise(self):
        with pytest.raises(ValueError):
            _intersect_lines((1, 0, 5), (1, 0, 10))

    def test_coincident_lines_raise(self):
        with pytest.raises(ValueError):
            _intersect_lines((1, 0, 5), (2, 0, 10))


class TestApplyOffsets:
    def test_zero_offsets_preserves_coords(self):
        """δ=0 for all edges must leave every coordinate unchanged."""
        topo = make_rect_topology([10, 10, 10])
        original = {pid: topo.get_parcel_coords(pid) for pid in topo.parcels}
        result = apply_offsets(topo, {})
        for pid in topo.parcels:
            for (ox, oy), (nx, ny) in zip(original[pid], result[pid]):
                assert abs(ox - nx) < 1e-10
                assert abs(oy - ny) < 1e-10

    def test_total_area_conserved_single_offset(self):
        """Shifting one interior edge cannot create or destroy area."""
        topo = make_rect_topology([8, 14, 8])
        interior_id = topo.interior_edges()[0].id
        result = apply_offsets(topo, {interior_id: -2.0})

        original_total = sum(compute_areas(topo).values())
        new_total = sum(
            Polygon(result[pid] + [result[pid][0]]).area for pid in topo.parcels
        )
        assert abs(original_total - new_total) < 1e-5

    def test_total_area_conserved_multiple_offsets(self):
        """Shifting multiple interior edges conserves total area."""
        topo = make_rect_topology([8, 14, 8])
        interior = topo.interior_edges()
        offsets = {e.id: (-2.0 if i == 0 else 2.0) for i, e in enumerate(interior)}
        result = apply_offsets(topo, offsets)

        original_total = sum(compute_areas(topo).values())
        new_total = sum(
            Polygon(result[pid] + [result[pid][0]]).area for pid in topo.parcels
        )
        assert abs(original_total - new_total) < 1e-5

    def test_correct_offset_equalizes_areas(self):
        """
        For widths=[8,14,8], δ₁=-2 on the left edge and δ₂=+2 on the right
        edge should produce three equal lots of exactly 100 m².
        """
        topo = make_rect_topology([8, 14, 8])
        interior = topo.interior_edges()
        # Interior edges are ordered by creation (left-to-right in topology builder)
        # Map them by x-position of their canonical v0.
        def edge_x(e):
            return topo.vertices[e.v0_id].x

        left_edge, right_edge = sorted(interior, key=edge_x)

        # δ₁=-2 → edge at x=8 moves to x=10  (left-hand normal points west,
        #           so negative δ moves east)
        # δ₂=+2 → edge at x=22 moves to x=20  (negative sign, same reason)
        offsets = {left_edge.id: -2.0, right_edge.id: 2.0}
        result = apply_offsets(topo, offsets)

        for pid in topo.parcels:
            ring = result[pid] + [result[pid][0]]
            area = Polygon(ring).area
            assert abs(area - 100.0) < 1e-6, (
                f"Parcel {pid}: area={area:.6f}, expected 100.0"
            )
