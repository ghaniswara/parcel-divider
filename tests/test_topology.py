"""Tests for the topology builder (pee/topology.py)."""

import pytest
from shapely.geometry import LinearRing

from pee.exceptions import TopologyError
from tests.factories import make_rect_topology


class TestVertexDeduplication:
    def test_three_lot_vertex_count(self):
        """3-lot grid has 8 unique corners."""
        topo = make_rect_topology([10, 10, 10])
        assert len(topo.vertices) == 8

    def test_two_lot_vertex_count(self):
        topo = make_rect_topology([5, 5])
        assert len(topo.vertices) == 6


class TestEdgeClassification:
    def test_interior_edge_count_three_lots(self):
        topo = make_rect_topology([10, 10, 10])
        interior = topo.interior_edges()
        assert len(interior) == 2

    def test_interior_edge_count_two_lots(self):
        topo = make_rect_topology([5, 5])
        assert len(topo.interior_edges()) == 1

    def test_interior_edges_have_both_parcels(self):
        topo = make_rect_topology([10, 10, 10])
        for edge in topo.interior_edges():
            assert edge.left_parcel_id is not None
            assert edge.right_parcel_id is not None
            assert edge.left_parcel_id != edge.right_parcel_id

    def test_exterior_edges_have_exactly_one_parcel(self):
        topo = make_rect_topology([10, 10, 10])
        for edge in topo.edges.values():
            if edge.is_exterior:
                n = sum([
                    edge.left_parcel_id is not None,
                    edge.right_parcel_id is not None,
                ])
                assert n == 1, f"Exterior edge {edge.id} must have exactly 1 parcel"


class TestParcels:
    def test_parcel_count(self):
        topo = make_rect_topology([8, 14, 8])
        assert len(topo.parcels) == 3

    def test_each_parcel_has_four_edges(self):
        """Every rectangular lot is a quadrilateral."""
        topo = make_rect_topology([10, 10, 10])
        for parcel in topo.parcels.values():
            assert len(parcel.edge_ids) == 4

    def test_vertex_ids_match_edge_ids_length(self):
        topo = make_rect_topology([10, 10, 10])
        for parcel in topo.parcels.values():
            assert len(parcel.vertex_ids) == len(parcel.edge_ids)


class TestOuterRing:
    def test_outer_stored(self):
        topo = make_rect_topology([10, 10, 10])
        assert topo.outer is not None

    def test_outer_has_four_corners(self):
        topo = make_rect_topology([10, 10, 10])
        assert len(topo.outer) == 4


class TestWindingOrder:
    def test_exterior_rings_are_ccw(self):
        """Shapely guarantees CCW exterior rings — topology builder must preserve this."""
        topo = make_rect_topology([10, 10, 10])
        for pid in topo.parcels:
            coords = topo.get_parcel_coords(pid)
            ring = LinearRing(coords + [coords[0]])
            assert ring.is_ccw, f"Parcel {pid} ring is not CCW"
