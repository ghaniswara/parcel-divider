"""Tests for the post-optimization geometry validator (pee/validator.py)."""

import pytest

from pee.exceptions import ValidationError
from pee.model import Edge, Parcel, Topology, Vertex
from pee.optimizer import optimize
from pee.validator import validate
from tests.factories import make_rect_topology


def _mark_interior_movable(topo):
    for e in topo.interior_edges():
        e.movable = True
        e.min_offset = -5.0
        e.max_offset = 5.0


class TestValidGeometry:
    def test_initial_topology_passes(self):
        """A freshly built topology should pass validation without errors."""
        topo = make_rect_topology([10, 10, 10])
        validate(topo)  # must not raise

    def test_optimized_topology_passes(self):
        """An optimized topology must also pass validation."""
        topo = make_rect_topology([8, 14, 8])
        _mark_interior_movable(topo)
        result = optimize(topo)
        validate(result.topology)  # must not raise


class TestSelfIntersection:
    def test_bowtie_polygon_raises(self):
        """
        A topology containing a self-intersecting (bowtie) polygon must raise.

        We build it by hand — bypassing build_topology which only accepts
        valid Shapely polygons.
        """
        # Bowtie: (0,0)→(10,10)→(10,0)→(0,10) — edges cross at (5,5)
        topo = Topology()
        topo.vertices = {
            0: Vertex(0, 0, 0),
            1: Vertex(1, 10, 10),
            2: Vertex(2, 10, 0),
            3: Vertex(3, 0, 10),
        }
        topo.parcels = {
            0: Parcel(0, vertex_ids=[0, 1, 2, 3], edge_ids=[0, 1, 2, 3])
        }
        topo.edges = {
            0: Edge(0, 0, 1, left_parcel_id=0),
            1: Edge(1, 1, 2, left_parcel_id=0),
            2: Edge(2, 2, 3, left_parcel_id=0),
            3: Edge(3, 3, 0, left_parcel_id=0),
        }
        topo.outer = [(0, 0), (10, 0), (10, 10), (0, 10)]

        with pytest.raises(ValidationError, match="invalid geometry"):
            validate(topo)


class TestOverlap:
    def test_overlapping_parcels_raise(self):
        """
        Two parcels whose boundaries overlap must raise ValidationError.

        We manually build a topology where lot 0 = (0..10, 0..10) and
        lot 1 = (5..15, 0..10), overlapping in the strip x=5..10.
        """
        topo = Topology()
        topo.vertices = {
            0: Vertex(0, 0, 0),
            1: Vertex(1, 10, 0),
            2: Vertex(2, 10, 10),
            3: Vertex(3, 0, 10),
            4: Vertex(4, 5, 0),
            5: Vertex(5, 15, 0),
            6: Vertex(6, 15, 10),
            7: Vertex(7, 5, 10),
        }
        topo.parcels = {
            0: Parcel(0, vertex_ids=[0, 1, 2, 3], edge_ids=[0, 1, 2, 3]),
            1: Parcel(1, vertex_ids=[4, 5, 6, 7], edge_ids=[4, 5, 6, 7]),
        }
        topo.edges = {
            0: Edge(0, 0, 1, left_parcel_id=0),
            1: Edge(1, 1, 2, left_parcel_id=0),
            2: Edge(2, 2, 3, left_parcel_id=0),
            3: Edge(3, 3, 0, left_parcel_id=0),
            4: Edge(4, 4, 5, left_parcel_id=1),
            5: Edge(5, 5, 6, left_parcel_id=1),
            6: Edge(6, 6, 7, left_parcel_id=1),
            7: Edge(7, 7, 4, left_parcel_id=1),
        }
        topo.outer = None  # Skip outer-boundary check

        with pytest.raises(ValidationError, match="overlap"):
            validate(topo)


class TestGaps:
    def test_gap_between_parcels_raises(self):
        """
        A partition that leaves a gap inside the outer boundary must raise.

        We use two lots that together cover only x=0..8 and x=12..20,
        leaving a gap in x=8..12.
        """
        topo = Topology()
        topo.vertices = {
            0: Vertex(0, 0, 0),
            1: Vertex(1, 8, 0),
            2: Vertex(2, 8, 10),
            3: Vertex(3, 0, 10),
            4: Vertex(4, 12, 0),
            5: Vertex(5, 20, 0),
            6: Vertex(6, 20, 10),
            7: Vertex(7, 12, 10),
        }
        topo.parcels = {
            0: Parcel(0, vertex_ids=[0, 1, 2, 3], edge_ids=[0, 1, 2, 3]),
            1: Parcel(1, vertex_ids=[4, 5, 6, 7], edge_ids=[4, 5, 6, 7]),
        }
        topo.edges = {
            0: Edge(0, 0, 1, left_parcel_id=0),
            1: Edge(1, 1, 2, left_parcel_id=0),
            2: Edge(2, 2, 3, left_parcel_id=0),
            3: Edge(3, 3, 0, left_parcel_id=0),
            4: Edge(4, 4, 5, left_parcel_id=1),
            5: Edge(5, 5, 6, left_parcel_id=1),
            6: Edge(6, 6, 7, left_parcel_id=1),
            7: Edge(7, 7, 4, left_parcel_id=1),
        }
        topo.outer = [(0, 0), (20, 0), (20, 10), (0, 10)]

        with pytest.raises(ValidationError, match="[Gg]ap"):
            validate(topo)
