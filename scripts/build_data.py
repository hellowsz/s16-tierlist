"""从 lolesports 官方 Flickr 的 Worlds 2026 相册为每位选手挑照片，生成 data.js 并下载图片。

用法: venv/bin/python build_data.py <存放 set_*.json 与 teams.json 的目录>
需要 pyobjc-framework-Vision（人脸检测，用来挑特写并定位裁切中心）。
"""
import glob, json, re, subprocess, sys, time
from pathlib import Path

from faces import detect_faces

SETS_DIR = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "img"
MAX_PHOTOS = 3
MAX_CANDIDATES = 8
FACE_WEIGHT = 300  # 人脸占图高 0.1 → +30 分，鼓励挑特写

TEAMS = [
    ("GEN", "Gen.G", "LCK", ["Kiin", "Canyon", "Chovy", "Ruler", "Duro"]),
    ("HLE", "Hanwha Life Esports", "LCK", ["Zeus", "Kanavi", "Zeka", "Gumayusi", "Delight"]),
    ("T1", "T1", "LCK", ["Doran", "Oner", "Faker", "Peyz", "Keria"]),
    ("DK", "Dplus KIA", "LCK", ["Siwoo", "Lucid", "ShowMaker", "Smash", "Career"]),
    ("AL", "Anyone's Legend", "LPL", ["Breathe", "Tarzan", "Shanks", "Hope", "Kael"]),
    ("BLG", "Bilibili Gaming", "LPL", ["Bin", "Xun", "Knight", "Viper", "ON"]),
    ("TES", "Top Esports", "LPL", ["369", "Tian", "Creme", "JackeyLove", "Zhuo"]),
    ("IG", "Invictus Gaming", "LPL", ["TheShy", "Wei", "Rookie", "JiaQi", "Meiko"]),
    ("G2", "G2 Esports", "LEC", ["BrokenBlade", "SkewMond", "Caps", "Hans Sama", "Labrov"]),
    ("MKOI", "Movistar KOI", "LEC", ["Myrwn", "Elyoya", "Jojopyun", "Supa", "Alvaro"]),
    ("KC", "Karmine Corp", "LEC", ["Canna", "Yike", "kyeahoo", "Caliste", "Busio"]),
    ("TL", "Team Liquid", "LCS", ["Morgan", "Josedeodo", "Quid", "Yeon", "CoreJJ"]),
    ("LYON", "LYON", "LCS", ["Dhokla", "Inspired", "Saint", "Berserker", "Isles"]),
    ("C9", "Cloud9", "LCS", ["Thanatos", "Blaber", "Loki", "Tactical", "Vulcan"]),
    ("TSW", "Team Secret Whales", "LCP", ["Pun", "Hizto", "Dire", "Eddie", "Bie"]),
    ("CFO", "CTBC Flying Oyster", "LCP", ["Rest", "Shad0w", "POUT", "Doggo", "Kino"]),
    ("MVK", "MVK Esports", "LCP", ["Kratos", "Gury", "Chika", "Harky", "SiuLoong"]),
    ("LOS", "LOS", "CBLOL", ["Zest", "Curse", "Feisty", "Duduhh", "Ackerman"]),
    ("FUR", "FURIA", "CBLOL", ["Guigo", "Tatu", "Tutsz", "Ayu", "JoJo"]),
]
ROLES = ["top", "jungle", "mid", "bot", "support"]
ALBUM_SCORE = {"Asset Day": 100, "Features": 60}
# 官方 S 赛相册里没有单人照的选手，回退到 lolesports 2026 赛季官方头像
FALLBACK_TEAMS = {"TES": "top-esports", "IG": "invictus-gaming", "G2": "g2-esports",
                  "CFO": "ctbc-flying-oyster", "TSW": "team-secret-whales"}


def load_fallbacks():
    teams = json.load(open(SETS_DIR / "teams.json"))["data"]["teams"]
    slugs = set(FALLBACK_TEAMS.values())
    return {p["summonerName"].strip().lower(): p["image"] for t in teams if t["slug"] in slugs
            for p in t["players"] if "default-headshot" not in p["image"]}


def load_photos():
    photos = []
    for f in glob.glob(str(SETS_DIR / "set_*.json")):
        ps = json.load(open(f))["photoset"]
        bonus = next((v for k, v in ALBUM_SCORE.items() if k in ps["title"]), 0)
        for p in ps["photo"]:
            if "url_l" in p:
                photos.append({**p, "desc": p["description"]["_content"], "bonus": bonus})
    return photos


def score(photo, name):
    """单人照得高分；双人照(L)标注时按左右裁切；其余不要。"""
    desc, n = photo["desc"], re.escape(name)
    portrait = 5 if int(photo["height_l"]) > int(photo["width_l"]) else 0
    if re.match(rf"^{n} of ", desc, re.I):
        return photo["bonus"] + portrait + 20, "center"
    duo = re.match(r"^(\S+(?: Sama)?) \(L\) and (\S+(?: Sama)?) of ", desc)
    if duo and name.lower() in (duo.group(1).lower(), duo.group(2).lower()):
        side = "25%" if duo.group(1).lower() == name.lower() else "75%"
        return photo["bonus"] - 50, side
    return None, None


def candidates(photos, name):
    scored = []
    for p in photos:
        s, pos = score(p, name)
        if s is not None:
            scored.append({"score": s, "id": p["id"], "url": p["url_l"], "pos": pos})
    return sorted(scored, key=lambda x: -x["score"])[:MAX_CANDIDATES]


def subject_face(faces, pos):
    """单人照取最大的脸；双人照在最大的两张脸里按 (L) 取左或右。"""
    if not faces:
        return None
    biggest = sorted(faces, key=lambda f: -f[3])
    if pos == "center":
        return biggest[0]
    pair = sorted(biggest[:2], key=lambda f: f[0])
    return pair[0] if pos == "25%" else pair[-1]


def crop_of(face, pos):
    """裁切参数: 焦点 x/y（0~1）和人脸高度占比 fh；没检测到脸就按左右/居中兜底。"""
    if face is None:
        x = {"25%": 0.25, "75%": 0.75}.get(pos, 0.5)
        return {"x": x, "y": 0.35, "fh": 0}
    x, y, w, h = face
    return {"x": round(x + w / 2, 4), "y": round(y + h * 0.85, 4), "fh": round(h, 4)}


def pick(photos, name):
    """下载候选图，按 文案分 + 人脸大小 重排，取前 MAX_PHOTOS 张。"""
    ranked = []
    for c in candidates(photos, name):
        dest = IMG_DIR / f"{c['id']}.jpg"
        if not download(c["url"], dest):
            continue
        aspect, faces = detect_faces(dest)
        if aspect is None:
            continue
        face = subject_face(faces, c["pos"])
        total = c["score"] + (face[3] * FACE_WEIGHT if face else -40)
        ranked.append((total, {"src": f"img/{dest.name}", "ar": round(aspect, 4),
                               "crop": crop_of(face, c["pos"]), "official": True}))
    ranked.sort(key=lambda x: -x[0])
    return [img for _, img in ranked[:MAX_PHOTOS]]


def fallback_img(name, url):
    dest = IMG_DIR / f"fallback_{name}.jpg"
    if not download(url, dest):
        return None
    aspect, faces = detect_faces(dest)
    face = subject_face(faces, "center")
    return {"src": f"img/{dest.name}", "ar": round(aspect or 1, 4),
            "crop": crop_of(face, "center"), "official": False}


def download(url, dest):
    """下载并压缩到 640px；CDN 不稳定，失败重试，最终失败返回 False 由调用方跳过。"""
    if dest.exists():
        return True
    tmp = dest.with_suffix(".src")
    for attempt in range(5):
        r = subprocess.run(["curl", "-sSfL", "--max-time", "60", "-o", str(tmp), url])
        if r.returncode == 0:
            break
        time.sleep(3 * (attempt + 1))
    else:
        print(f"  download failed: {url}", file=sys.stderr)
        tmp.unlink(missing_ok=True)
        return False
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70",
                    "-Z", "640", str(tmp), "--out", str(dest)], check=True, capture_output=True)
    tmp.unlink()
    return True


def main():
    photos = load_photos()
    fallbacks = load_fallbacks()
    players, missing = [], []
    for code, team, region, names in TEAMS:
        for role, name in zip(ROLES, names):
            imgs = pick(photos, name)
            if not imgs:
                missing.append(name)
                fb = fallback_img(name, fallbacks[name.lower()]) if name.lower() in fallbacks else None
                imgs = [fb] if fb else []
            players.append({"id": f"{code}-{name}".replace(" ", ""), "name": name, "team": code,
                            "teamName": team, "region": region, "role": role, "imgs": imgs})
    out = ROOT / "data.js"
    out.write_text("window.PLAYERS = " + json.dumps(players, ensure_ascii=False, indent=1) + ";\n")
    used = {i["src"].split("/")[-1] for p in players for i in p["imgs"]}
    for f in IMG_DIR.glob("*.jpg"):
        if f.name not in used:
            f.unlink()
    print(f"{len(players)} players, {len(used)} images, no official single photo: {missing}")


if __name__ == "__main__":
    main()
