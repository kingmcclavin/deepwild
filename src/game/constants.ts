export const CHUNK = 16;
export const HEIGHT = 128;
export const CHUNK_AREA = CHUNK * CHUNK;
export const CHUNK_VOL = CHUNK_AREA * HEIGHT;
export const SEA_LEVEL = 62;

export const TICKS_PER_SECOND = 20;
export const DAY_TICKS = 24000; // one full day = 20 real minutes

export const enum Dim { Overworld = 0, Ember = 1, Void = 2 }
export const DIM_NAMES = ['Overworld', 'Emberdeep', 'The Hollow'];

export const idx = (x: number, y: number, z: number) => x + z * CHUNK + y * CHUNK_AREA;
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

// Directions: 0 -X, 1 +X, 2 -Y, 3 +Y, 4 -Z, 5 +Z
export const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
];
export const OPPOSITE = [1, 0, 3, 2, 5, 4];
// Horizontal facings used for orientable blocks (meta & 3): 0 north(-Z) 1 east(+X) 2 south(+Z) 3 west(-X)
export const FACING_VEC: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const FACING_TO_DIR = [4, 1, 5, 0];
