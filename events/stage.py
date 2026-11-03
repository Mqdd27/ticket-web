"""Generator konfigurasi panggung 3D. Dipanggil HANYA dari tombol admin, bukan otomatis."""
import random

PALETTES = [
    ["#3b82f6", "#a855f7", "#ec4899"],
    ["#f97316", "#facc15", "#ef4444"],
    ["#22d3ee", "#3b82f6", "#e0e7ff"],
    ["#10b981", "#84cc16", "#f0fdf4"],
    ["#f43f5e", "#8b5cf6", "#fde68a"],
]


def generate_scene(stage_type, seed=None):
    seed = seed if seed is not None else random.randrange(1, 10**9)
    r = random.Random(seed)
    scene = {"type": stage_type, "seed": seed, "palette": r.choice(PALETTES)}
    if stage_type in ("concert", "festival"):
        scene.update(performers=r.randint(3, 5), crowd=r.randint(220, 420), lights=r.randint(4, 8))
    elif stage_type == "standup":
        scene.update(audience_rows=r.randint(3, 5), neon=r.choice(["STAND UP", "OPEN MIC", "KOMEDI"]))
    elif stage_type == "seminar":
        scene.update(rows=r.randint(4, 7))
    elif stage_type == "exhibition":
        scene.update(frames=r.randint(6, 10))
    return scene


if __name__ == "__main__":
    a, b = generate_scene("concert", 42), generate_scene("concert", 42)
    assert a == b and 3 <= a["performers"] <= 5, a
    assert generate_scene("standup", 1)["type"] == "standup"
    print("ok")
