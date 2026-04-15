# BRIDGE LP用 画像生成プロンプト集

以下のプロンプトをMidjourney / DALL-E / ChatGPT にコピペして生成してください。
生成した画像は `output/sales/images/` に保存すれば、LPに自動で表示されます。

---

## 画像1: hero.png（メインビジュアル）

LP最上部。BRIDGEの世界観を一発で伝えるビジュアル。

### DALL-E / ChatGPT用

```
A minimal, editorial-style illustration of a confident person standing at the intersection of a modern hospital corridor and a sleek tech workspace. Warm beige and cream tones with subtle red accents. The person is looking at a tablet showing a simple dashboard. Clean lines, plenty of whitespace, Japanese editorial magazine aesthetic. No text. Aspect ratio 16:9.
```

### Midjourney用

```
minimal editorial illustration, person standing between hospital corridor and modern tech workspace, warm beige cream palette, subtle red accent color, holding tablet with dashboard, clean lines, whitespace, Japanese magazine aesthetic, no text --ar 16:9 --style raw --v 6
```

**保存先**: `images/hero.png`（横長、1600x900px推奨）

---

## 画像2-A: scene-1.png（現場の風景・左）

課題セクションの後。医療現場の「リアル」を伝える。

### DALL-E / ChatGPT用

```
A warm, documentary-style illustration of a rehabilitation room in a Japanese orthopedic clinic. A physical therapist is working with a patient. Soft natural lighting, warm beige tones. Minimal, clean illustration style like a Japanese lifestyle magazine. No text. Square format.
```

### Midjourney用

```
documentary illustration, rehabilitation room Japanese clinic, physical therapist working with patient, soft warm lighting, beige tones, minimal clean style, Japanese lifestyle magazine aesthetic, no text --ar 1:1 --style raw --v 6
```

**保存先**: `images/scene-1.png`（正方形、800x800px推奨）

---

## 画像2-B: scene-2.png（現場の風景・右）

scene-1と並べて表示。対比を作る。

### DALL-E / ChatGPT用

```
A warm, minimal illustration of a morning meeting in a small Japanese clinic. A team leader is standing at a whiteboard showing simple charts to 3-4 staff members sitting in a circle. Warm beige tones with a touch of red. Clean, editorial illustration style. No text. Square format.
```

### Midjourney用

```
minimal illustration, morning meeting small Japanese clinic, team leader at whiteboard with simple charts, staff members sitting, warm beige tones, red accent, editorial style, no text --ar 1:1 --style raw --v 6
```

**保存先**: `images/scene-2.png`（正方形、800x800px推奨）

---

## 画像3: tech.png（テクノロジー × 現場）

プロダクトセクションの直前。「軽い技術」の印象。

### DALL-E / ChatGPT用

```
A minimal, overhead flat-lay style illustration showing a tablet displaying a clean dashboard next to a cup of coffee, a simple notebook, and a pen on a warm beige desk. The dashboard shows bar charts and KPI numbers. Warm, calm, professional atmosphere. Illustration style, not photorealistic. No text on the image. Aspect ratio 16:9.
```

### Midjourney用

```
minimal overhead flat lay illustration, tablet with clean dashboard, coffee cup, notebook, pen, warm beige desk, bar charts and KPI numbers on screen, calm professional atmosphere, illustration style, no text --ar 16:9 --style raw --v 6
```

**保存先**: `images/tech.png`（横長、1600x900px推奨）

---

## スタイル共通指示

LPのデザインに合わせるため、全画像で以下を守ってください:

- **カラー**: 暖かいベージュ基調（#f5f2ed系）に朱色（#c23a22）のアクセント
- **トーン**: ミニマル、エディトリアル、日本の雑誌的な上品さ
- **避けるもの**: ネオンカラー、3Dレンダリング、ストック写真感、テキスト入り
- **フォーマット**: PNG推奨、各サイズは上記参照
