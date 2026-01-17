"""
Spatial hash grid for efficient collision detection.
Divides the screen into cells and only checks collisions between objects in nearby cells.
"""


class SpatialGrid:
    def __init__(self, width, height, cell_size):
        """
        Initialize the spatial grid.

        Args:
            width: Screen width in pixels
            height: Screen height in pixels
            cell_size: Size of each grid cell (should be >= largest object diameter)
        """
        self.cell_size = cell_size
        self.cols = (width // cell_size) + 1
        self.rows = (height // cell_size) + 1
        self.cells = {}

    def clear(self):
        """Clear all objects from the grid."""
        self.cells.clear()

    def _get_cell_key(self, x, y):
        """Get the cell key for a position."""
        col = int(x // self.cell_size)
        row = int(y // self.cell_size)
        return (col, row)

    def _get_cell_keys_for_object(self, obj):
        """
        Get all cell keys that an object overlaps.
        Objects near cell boundaries may be in multiple cells.
        """
        x, y = obj.position.x, obj.position.y
        r = obj.radius

        min_col = int((x - r) // self.cell_size)
        max_col = int((x + r) // self.cell_size)
        min_row = int((y - r) // self.cell_size)
        max_row = int((y + r) // self.cell_size)

        keys = []
        for col in range(min_col, max_col + 1):
            for row in range(min_row, max_row + 1):
                keys.append((col, row))
        return keys

    def insert(self, obj):
        """Insert an object into the grid."""
        for key in self._get_cell_keys_for_object(obj):
            if key not in self.cells:
                self.cells[key] = []
            self.cells[key].append(obj)

    def insert_all(self, objects):
        """Insert multiple objects into the grid."""
        for obj in objects:
            self.insert(obj)

    def get_nearby(self, obj):
        """
        Get all objects that could potentially collide with the given object.
        Returns objects in the same and neighboring cells.
        """
        nearby = set()
        for key in self._get_cell_keys_for_object(obj):
            if key in self.cells:
                for other in self.cells[key]:
                    if other is not obj:
                        nearby.add(other)
        return nearby

    def get_nearby_point(self, x, y, radius=0):
        """
        Get all objects near a point (useful for point-based queries).
        """
        nearby = set()

        min_col = int((x - radius) // self.cell_size)
        max_col = int((x + radius) // self.cell_size)
        min_row = int((y - radius) // self.cell_size)
        max_row = int((y + radius) // self.cell_size)

        for col in range(min_col, max_col + 1):
            for row in range(min_row, max_row + 1):
                key = (col, row)
                if key in self.cells:
                    nearby.update(self.cells[key])
        return nearby


def check_collisions_grid(group_a, group_b, grid, collision_func=None):
    """
    Check collisions between two groups using spatial grid.

    Args:
        group_a: First group of objects (will be inserted into grid)
        group_b: Second group of objects (will query grid)
        grid: SpatialGrid instance (should be cleared before use)
        collision_func: Optional custom collision function(a, b) -> bool
                       If None, uses a.check_collision(b)

    Returns:
        List of (obj_a, obj_b) collision pairs
    """
    # Insert group_a into grid
    grid.clear()
    for obj in group_a:
        grid.insert(obj)

    # Check each object in group_b against nearby objects in group_a
    collisions = []
    for obj_b in group_b:
        nearby = grid.get_nearby(obj_b)
        for obj_a in nearby:
            if collision_func:
                if collision_func(obj_a, obj_b):
                    collisions.append((obj_a, obj_b))
            else:
                if obj_a.check_collision(obj_b):
                    collisions.append((obj_a, obj_b))

    return collisions
