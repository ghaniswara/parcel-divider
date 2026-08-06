"""Shared pytest fixtures."""

import pytest

from tests.factories import make_rect_topology


@pytest.fixture
def equal_topology():
    """Three equal 10×10 lots (each 100 m²)."""
    return make_rect_topology([10, 10, 10])


@pytest.fixture
def unequal_topology():
    """Three unequal lots: 80, 140, 80 m² (total 300 m², target 100 each)."""
    return make_rect_topology([8, 14, 8])
