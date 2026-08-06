"""Custom exceptions for the Parcel Equalization Engine."""


class PEEError(Exception):
    """Base exception for all PEE errors."""


class TopologyError(PEEError):
    """Raised when input geometry violates topology constraints."""


class ValidationError(PEEError):
    """Raised when output geometry fails post-optimization validation."""


class LoaderError(PEEError):
    """Raised when input data cannot be parsed or is structurally invalid."""


class OptimizationError(PEEError):
    """Raised when the optimizer encounters an unrecoverable error."""
