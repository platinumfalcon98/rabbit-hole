import json
from pathlib import Path
import subprocess
import unittest
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]

class IconFontTest(unittest.TestCase):
    def test_encoded_glyph_matches_every_grid_cell(self):
        data = json.loads(subprocess.check_output(
            ["node", str(ROOT / "scripts/carrot-data.js")], cwd=ROOT))
        with TTFont(ROOT / "resources/rabbithole-icons.woff") as font:
            self.assertEqual(font.flavor, "woff")
            self.assertEqual(font.getBestCmap(), {0xE001: "carrot"})
            self.assertEqual(font.getGlyphOrder(), [".notdef", "carrot"])
            self.assertEqual(font["head"].unitsPerEm, 1024)
            self.assertEqual(font["hmtx"]["carrot"], (1024, 64))
            self.assertEqual((font["hhea"].ascent, font["hhea"].descent), (832, -192))
            glyph = font["glyf"]["carrot"]
            coords, ends, flags = glyph.getCoordinates(font["glyf"])
            actual = []
            start = 0
            for end in ends:
                pts = [tuple(p) for p in coords[start:end + 1]]
                self.assertEqual(len(pts), 4)
                self.assertTrue(all(int(f) & 1 for f in flags[start:end + 1]))
                actual.append(tuple(pts))
                start = end + 1
            expected = []
            for y, row in enumerate(data["rows"]):
                for x, ch in enumerate(row):
                    if ch != ".":
                        left, bottom = 64 + x * 64, (9 - y) * 64
                        expected.append(((left, bottom), (left, bottom + 64),
                                         (left + 64, bottom + 64), (left + 64, bottom)))
            self.assertCountEqual(actual, expected)
            self.assertEqual((glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax),
                             (64, 0, 960, 640))

if __name__ == "__main__":
    unittest.main()
