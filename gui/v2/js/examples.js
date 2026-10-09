/**
 * @module examples
 * Built-in quick-start geometries (GeoJSON-style `{outer, parcels:[...]}`).
 * Ported verbatim from gui/index.html (v1).
 */

/**
 * @type {Object<string, {outer: Object, parcels: Object[]}>}
 */
export const EXAMPLES = {
  "3lot": {
    outer: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [30, 0],
          [30, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
    parcels: [
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [8, 0],
            [8, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [8, 0],
            [22, 0],
            [22, 10],
            [8, 10],
            [8, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [22, 0],
            [30, 0],
            [30, 10],
            [22, 10],
            [22, 0],
          ],
        ],
      },
    ],
  },
  "5lot": {
    outer: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [50, 0],
          [50, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
    parcels: [
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [5, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [5, 0],
            [20, 0],
            [20, 10],
            [5, 10],
            [5, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [20, 0],
            [28, 0],
            [28, 10],
            [20, 10],
            [20, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [28, 0],
            [40, 0],
            [40, 10],
            [28, 10],
            [28, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [40, 0],
            [50, 0],
            [50, 10],
            [40, 10],
            [40, 0],
          ],
        ],
      },
    ],
  },
  lshape: {
    outer: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [20, 0],
          [20, 8],
          [10, 8],
          [10, 16],
          [0, 16],
          [0, 0],
        ],
      ],
    },
    parcels: [
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 8],
            [0, 8],
            [0, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [10, 0],
            [20, 0],
            [20, 8],
            [10, 8],
            [10, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 8],
            [10, 8],
            [10, 16],
            [0, 16],
            [0, 8],
          ],
        ],
      },
    ],
  },
  fan: {
    outer: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [16, 0],
          [16, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
    parcels: [
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [16, 0],
            [8, 5],
            [0, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [16, 0],
            [16, 10],
            [8, 5],
            [16, 0],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [16, 10],
            [0, 10],
            [0, 0],
            [8, 5],
            [16, 10],
          ],
        ],
      },
    ],
  },
};
