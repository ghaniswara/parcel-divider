"""Serialise OptimizeResult back to GeoJSON."""

from __future__ import annotations

from pee.optimizer import OptimizeResult


def to_geojson(result: OptimizeResult) -> dict:
    """
    Convert an :class:`~pee.optimizer.OptimizeResult` to a GeoJSON FeatureCollection.

    Each parcel becomes a Feature with the following properties:

    .. code-block:: json

        {
            "id":             0,
            "area":           100.0,
            "target_area":    100.0,
            "area_error_pct": 0.0
        }

    The FeatureCollection also carries a top-level ``"stats"`` key:

    .. code-block:: json

        {
            "success":            true,
            "iterations":         12,
            "max_area_error_pct": 0.0,
            "message":            "Optimization terminated successfully.",
            "final_offsets":      {"3": -2.0, "5": 2.0}
        }

    Parameters
    ----------
    result : OptimizeResult

    Returns
    -------
    dict
        A GeoJSON FeatureCollection.
    """
    features = []

    for parcel_id, parcel in result.topology.parcels.items():
        coords = result.topology.get_parcel_coords(parcel_id)
        closed_ring = [[x, y] for x, y in coords + [coords[0]]]

        target = result.target_areas[parcel_id]
        area = result.parcel_areas[parcel_id]
        error_pct = abs(area - target) / target * 100 if target > 0 else 0.0

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": parcel_id,
                    "area": round(area, 6),
                    "target_area": round(target, 6),
                    "area_error_pct": round(error_pct, 4),
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [closed_ring],
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
        "stats": {
            "success": result.success,
            "iterations": result.iterations,
            "max_area_error_pct": round(result.max_area_error_pct, 4),
            "message": result.message,
            "final_offsets": {
                str(eid): round(delta, 8)
                for eid, delta in result.final_offsets.items()
            },
        },
    }
