"""Generate synthetic, fully invented screenshots (no real user data) at several widths."""
from PIL import Image, ImageDraw, ImageFont
import os, random
OUT = os.path.join(os.path.dirname(__file__), "img")
random.seed(7)

def font(sz):
    try:
        return ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", sz)
    except Exception:
        return ImageFont.load_default(size=sz)

def ide(w=2880, h=1800):
    im = Image.new("RGB", (w, h), (30, 31, 36)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 56], fill=(45, 46, 52)); d.text((24, 12), "weather-widget — src/forecast/merge.ts", fill=(220, 220, 220), font=font(30))
    d.rectangle([0, 56, 520, h], fill=(37, 38, 44))
    for i, n in enumerate(["src", "  forecast", "    merge.ts", "    fetch.ts", "    cache.ts", "  ui", "    Card.tsx", "tests", "  merge.test.ts", "package.json"]):
        d.text((24, 90 + i * 44), n, fill=(180, 180, 190), font=font(26))
    code = ["export function mergeForecasts(a: Forecast[], b: Forecast[]): Forecast[] {",
            "  const byHour = new Map<number, Forecast>();",
            "  for (const f of [...a, ...b]) {",
            "    const prev = byHour.get(f.hour);",
            "    if (!prev || f.issuedAt > prev.issuedAt) byHour.set(f.hour, f);",
            "  }",
            "  return [...byHour.values()].sort((x, y) => x.hour - y.hour);",
            "}", "", "// TODO: handle timezone offsets from the provider",
            "export async function refresh(city: string) {",
            "  const [primary, backup] = await Promise.all([fetchPrimary(city), fetchBackup(city)]);",
            "  return mergeForecasts(primary, backup);", "}"]
    for i, line in enumerate(code * 2):
        d.text((580, 90 + i * 46), f"{i+1:>3}  {line}", fill=(200, 210, 230) if i % 3 else (150, 200, 150), font=font(28))
    d.rectangle([520, h - 380, w, h], fill=(24, 25, 29))
    for i, line in enumerate(["$ npm test -- merge", " PASS  tests/merge.test.ts", "  ✓ keeps newest forecast per hour (3 ms)", "  ✕ handles DST shift (12 ms)", "Tests: 1 failed, 1 passed"]):
        d.text((560, h - 350 + i * 50), line, fill=(230, 120, 120) if "✕" in line or "failed" in line else (170, 220, 170), font=font(28))
    return im

def browser(w=2880, h=1800):
    im = Image.new("RGB", (w, h), (250, 250, 250)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 110], fill=(232, 234, 237)); d.rounded_rectangle([200, 30, w - 200, 90], 20, fill=(255, 255, 255))
    d.text((240, 42), "https://recipes.example.org/sourdough/starter-feeding-schedule", fill=(60, 60, 60), font=font(30))
    d.text((300, 200), "Sourdough starter: a feeding schedule that works", fill=(20, 20, 20), font=font(64))
    para = "Feed the starter at a 1:2:2 ratio of starter, flour and water. Keep it at 24°C. It should double within six hours. "
    for i in range(22):
        d.text((300, 330 + i * 52), (para * 3)[i * 7 % 60: i * 7 % 60 + 120], fill=(70, 70, 70), font=font(30))
    d.rectangle([w - 820, 330, w - 220, 1000], fill=(240, 236, 228)); d.text((w - 780, 360), "Shopping list", fill=(30, 30, 30), font=font(40))
    for i, item in enumerate(["whole wheat flour 1kg", "rye flour 500g", "kitchen scale", "glass jar"]):
        d.text((w - 780, 440 + i * 60), "• " + item, fill=(50, 50, 50), font=font(32))
    return im

def save_sizes(im, name):
    for width in (512, 768, 1024, 1568, 2048):
        h = round(im.height * width / im.width)
        im.resize((width, h), Image.LANCZOS).save(os.path.join(OUT, f"{name}_{width}.jpg"), quality=80)

save_sizes(ide(), "ide"); save_sizes(browser(), "browser")
print(sorted(os.listdir(OUT)))
