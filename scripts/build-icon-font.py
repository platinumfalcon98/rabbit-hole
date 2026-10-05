import json
from pathlib import Path
import subprocess
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parents[1]
data = json.loads(subprocess.check_output(
    ["node", str(ROOT / "scripts/carrot-data.js")], cwd=ROOT))
assert data["width"] == 14 and data["height"] == 10
pen = TTGlyphPen(None)
for y, row in enumerate(data["rows"]):
    for x, cell in enumerate(row):
        if cell == ".":
            continue
        left, bottom = 64 + x * 64, (9 - y) * 64
        pen.moveTo((left, bottom))
        pen.lineTo((left, bottom + 64))
        pen.lineTo((left + 64, bottom + 64))
        pen.lineTo((left + 64, bottom))
        pen.closePath()

fb = FontBuilder(1024, isTTF=True)
fb.setupGlyphOrder([".notdef", "carrot"])
fb.setupCharacterMap({0xE001: "carrot"})
fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "carrot": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (1024, 0), "carrot": (1024, 64)})
fb.setupHorizontalHeader(ascent=832, descent=-192, lineGap=0)
fb.setupNameTable({
    "familyName": "Rabbit Hole Icons", "styleName": "Regular",
    "uniqueFontIdentifier": "RabbitHoleIcons-Regular-1",
    "fullName": "Rabbit Hole Icons Regular", "psName": "RabbitHoleIcons-Regular",
    "version": "Version 1.000",
})
fb.setupOS2(sTypoAscender=832, sTypoDescender=-192, sTypoLineGap=0,
            usWinAscent=832, usWinDescent=192, fsType=0)
fb.setupPost()
# Fixed OpenType epoch timestamps prevent time-only changes on regeneration.
fb.font["head"].created = fb.font["head"].modified = 3800000000
fb.font.recalcTimestamp = False
fb.font.flavor = "woff"
output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "resources/rabbithole-icons.woff"
output.parent.mkdir(parents=True, exist_ok=True)
fb.save(str(output))
