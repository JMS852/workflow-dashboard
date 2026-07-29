"""
Manual ICO builder — constructs valid multi-resolution .ico from PNG images.
Pillow's ICO writer has bugs with certain configurations; this bypasses it.
"""
import os
import struct
import io
from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")
SIZES = [16, 24, 32, 48, 64, 128, 256]


def draw_icon(size: int) -> Image.Image:
    """Draw the sci-fi icon at the given size. Returns RGBA PIL Image."""
    import math
    draw = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = draw.load()  # pixel access
    s = size

    # Colors
    BG       = (8, 8, 16, 255)
    CYAN     = (0, 229, 255, 255)
    CYAN_DIM = (0, 140, 200, 80)
    CORNER   = (0, 200, 255, 255)
    WHITE_G  = (200, 245, 255, 255)
    DARK_C   = (0, 160, 200, 255)
    ACCENT_DIM = (0, 180, 220, 100)

    cx, cy = s / 2, s / 2
    hex_r  = s * 0.42

    # Helper: check if pixel is inside hexagon
    def hex_dist(px, py):
        qx = abs(px - cx) - hex_r * 0.5
        qy = abs(py - cy) - hex_r * 0.8660254
        return max(qx, 0) + max(qy, 0)

    # Helper: signal bar check
    bar_w = s * 0.055
    bar_gap = s * 0.04
    bar_heights = [s * 0.18, s * 0.30, s * 0.42]
    total_w = 3 * bar_w + 2 * bar_gap
    start_x = cx - total_w / 2
    bar_base_y = cy + hex_r * 0.55

    def in_bar(px, py, idx):
        left = start_x + idx * (bar_w + bar_gap)
        right = left + bar_w
        top = bar_base_y - bar_heights[idx]
        if left <= px <= right and top <= py <= bar_base_y:
            # rounded top cap
            cap_r = bar_w * 0.42
            if py < top + cap_r:
                # check corners
                if px < left + cap_r:
                    dl = ((px - (left + cap_r))**2 + (py - (top + cap_r))**2) ** 0.5
                    return dl <= cap_r
                if px > right - cap_r:
                    dr = ((px - (right - cap_r))**2 + (py - (top + cap_r))**2) ** 0.5
                    return dr <= cap_r
            return True
        return False

    # Draw pixel-by-pixel
    for y in range(s):
        for x in range(s):
            # Rounded rect background (corner radius ~11%)
            bg_r = s * 0.11
            in_bg = True
            if x < bg_r and y < bg_r and ((x - bg_r)**2 + (y - bg_r)**2)**0.5 > bg_r:
                in_bg = False
            if x >= s - bg_r and y < bg_r and ((x - (s - bg_r))**2 + (y - bg_r)**2)**0.5 > bg_r:
                in_bg = False
            if x < bg_r and y >= s - bg_r and ((x - bg_r)**2 + (y - (s - bg_r))**2)**0.5 > bg_r:
                in_bg = False
            if x >= s - bg_r and y >= s - bg_r and ((x - (s - bg_r))**2 + (y - (s - bg_r))**2)**0.5 > bg_r:
                in_bg = False

            if in_bg:
                d[x, y] = BG

            # Hexagon outer stroke (2px wide)
            hd = hex_dist(x, y)
            fw = max(1.5, s * 0.022)
            if abs(hd) <= fw:
                d[x, y] = CYAN

            # Inner hex
            inner_r = hex_r * 0.84
            ih = max(abs(x - cx) - inner_r * 0.5, 0) + max(abs(y - cy) - inner_r * 0.8660254, 0)
            if abs(ih) <= max(1, s * 0.01) and ih <= inner_r * 0.02:
                d[x, y] = CYAN_DIM if d[x, y][3] == 0 or d[x, y] == BG else d[x, y]

            # Corner nodes
            for i in range(6):
                angle = 3.14159 / 3 * i - 3.14159 / 6
                nx = cx + hex_r * math.cos(angle)
                ny = cy + hex_r * math.sin(angle)
                nr = max(1.5, s * 0.025)
                if (x - nx)**2 + (y - ny)**2 <= nr**2:
                    d[x, y] = CORNER

            # Signal bars
            for bi in range(3):
                if in_bar(x, y, bi):
                    # Top edge white glow
                    left = start_x + bi * (bar_w + bar_gap)
                    top = bar_base_y - bar_heights[bi]
                    edge_h = max(1, bar_heights[bi] * 0.12)
                    if y <= top + edge_h:
                        d[x, y] = WHITE_G
                    else:
                        d[x, y] = CYAN

    return draw


def build_ico(sizes: list, out_path: str):
    """Manually pack PNG-compressed images into a valid .ico file."""
    png_buffers = []
    for sz in sizes:
        img = draw_icon(sz)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_buffers.append(buf.getvalue())

    with open(out_path, "wb") as f:
        # ICO header
        f.write(struct.pack("<HHH", 0, 1, len(sizes)))  # reserved=0, type=1(ICO), count

        # Directory entries (16 bytes each)
        data_offset = 6 + 16 * len(sizes)
        for sz, png_data in zip(sizes, png_buffers):
            img_sz = min(sz, 256)  # ICO stores 0 for 256px
            if img_sz >= 256:
                img_sz = 0
            f.write(struct.pack("<BBBBHHII",
                img_sz,      # width (0 = 256)
                img_sz,      # height (0 = 256)
                0,           # palette colors
                0,           # reserved
                1,           # color planes
                32,          # bits per pixel
                len(png_data),  # size of image data
                data_offset     # offset to image data
            ))
            data_offset += len(png_data)

        # Image data
        for png_data in png_buffers:
            f.write(png_data)

    print(f"  [OK] ICO ({','.join(str(s) for s in sizes)}) -> {out_path}")
    print(f"  Total: {data_offset} bytes, {len(sizes)} layers")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)

    # Also regenerate PNG
    icon_png = draw_icon(512)
    png_path = os.path.join(OUT_DIR, "icon.png")
    icon_png.save(png_path, "PNG")
    print(f"  [OK] PNG 512x512 -> {png_path}")

    ico_path = os.path.join(OUT_DIR, "icon.ico")
    build_ico(SIZES, ico_path)
    print("\nIcon generation complete!")
