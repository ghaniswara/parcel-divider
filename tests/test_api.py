"""End-to-end tests through the public equalize() API (pee/api.py)."""

import pytest

from pee import equalize
from pee.exceptions import LoaderError, OptimizationError
from pee.loader import EdgeConfig
from tests.factories import make_geojson


class TestEqualSplit:
    def test_unequal_lots_equalized(self):
        """80+140+80 → 100+100+100 through the public API."""
        result = equalize(make_geojson([8, 14, 8]), all_interior_movable=True)
        assert result["type"] == "FeatureCollection"
        assert result["stats"]["success"] is True
        assert result["stats"]["max_area_error_pct"] < 0.5
        for f in result["features"]:
            assert abs(f["properties"]["area"] - 100.0) < 1.0

    def test_already_equal_lots(self):
        """Equal lots should converge trivially."""
        result = equalize(make_geojson([10, 10, 10]), all_interior_movable=True)
        assert result["stats"]["success"] is True
        assert result["stats"]["max_area_error_pct"] < 0.1


class TestInputFormats:
    def test_feature_collection_format(self):
        """GeoJSON FeatureCollection input with role properties."""
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"role": "outer"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0,0],[30,0],[30,10],[0,10],[0,0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"role": "parcel"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0,0],[8,0],[8,10],[0,10],[0,0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"role": "parcel"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[8,0],[22,0],[22,10],[8,10],[8,0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"role": "parcel"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[22,0],[30,0],[30,10],[22,10],[22,0]]],
                    },
                },
            ],
        }
        result = equalize(fc, all_interior_movable=True)
        assert result["stats"]["success"] is True

    def test_explicit_edge_config(self):
        """EdgeConfig by coordinate should correctly identify movable edges."""
        result = equalize(
            make_geojson([8, 14, 8]),
            movable_edges=[
                EdgeConfig(v0=(8, 0), v1=(8, 10), min_offset=-5, max_offset=5),
                EdgeConfig(v0=(22, 0), v1=(22, 10), min_offset=-5, max_offset=5),
            ],
        )
        assert result["stats"]["success"] is True
        assert result["stats"]["max_area_error_pct"] < 0.5


class TestCustomTargets:
    def test_explicit_target_areas(self):
        result = equalize(
            make_geojson([8, 14, 8]),
            all_interior_movable=True,
            target_areas={0: 120.0, 1: 60.0, 2: 120.0},
        )
        assert result["stats"]["success"] is True
        areas = {f["properties"]["id"]: f["properties"]["area"] for f in result["features"]}
        assert abs(areas[0] - 120.0) < 1.5
        assert abs(areas[1] - 60.0) < 1.5
        assert abs(areas[2] - 120.0) < 1.5


class TestOutputStructure:
    def test_geojson_schema(self):
        result = equalize(make_geojson([10, 10, 10]), all_interior_movable=True)
        assert result["type"] == "FeatureCollection"
        assert isinstance(result["features"], list)
        assert len(result["features"]) == 3

        for f in result["features"]:
            assert f["type"] == "Feature"
            assert f["geometry"]["type"] == "Polygon"
            props = f["properties"]
            assert "id" in props
            assert "area" in props
            assert "target_area" in props
            assert "area_error_pct" in props

    def test_stats_schema(self):
        result = equalize(make_geojson([10, 10, 10]), all_interior_movable=True)
        stats = result["stats"]
        assert "success" in stats
        assert "iterations" in stats
        assert "max_area_error_pct" in stats
        assert "message" in stats
        assert "final_offsets" in stats

    def test_closed_rings(self):
        """Each parcel's ring must start and end at the same coordinate."""
        result = equalize(make_geojson([8, 14, 8]), all_interior_movable=True)
        for f in result["features"]:
            ring = f["geometry"]["coordinates"][0]
            assert ring[0] == ring[-1], "Ring is not closed"


class TestErrors:
    def test_no_movable_edges_raises(self):
        with pytest.raises(OptimizationError):
            equalize(make_geojson([8, 14, 8]))  # no movable edges

    def test_bad_geojson_raises(self):
        with pytest.raises(LoaderError):
            equalize({"garbage": True})
