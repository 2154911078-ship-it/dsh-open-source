#!/usr/bin/env python3
"""
桌宠帧处理脚本：背景透明化、统一尺寸、补帧、图集组装
"""
import os
import json
from PIL import Image, ImageFilter

# === 配置 ===
RAW_DIR = "/home/user/.super_doubao/super-doubao-runtime/workspace/pet/raw_frames"
OUT_DIR = "/home/user/.super_doubao/super-doubao-runtime/workspace/pet/frames"
PET_DIR = "/home/user/.super_doubao/super-doubao-runtime/workspace/pet"
CELL_SIZE = 256
COLS = 8
ROWS = 9
TOTAL_CELLS = COLS * ROWS  # 72

# 帧位映射：动作 -> (起始格, 帧数, 帧率, 是否循环, 关键帧序列)
# 关键帧索引对应 raw_frames 中的文件
FRAME_MAP = {
    "idle": {
        "start": 0, "count": 12, "fps": 6, "loop": True,
        "keys": ["idle_001", "idle_002", "idle_003", "idle_004"],
        # 12帧序列：呼吸+眨眼循环
        "sequence": [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1]
    },
    "walk": {
        "start": 12, "count": 16, "fps": 10, "loop": True,
        "keys": ["walk_001", "walk_002", "walk_003", "walk_004"],
        # 16帧：4帧步态循环x4
        "sequence": [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]
    },
    "run": {
        "start": 28, "count": 12, "fps": 12, "loop": True,
        "keys": ["run_001", "run_002", "run_003", "run_004"],
        # 12帧：4帧奔跑循环x3
        "sequence": [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]
    },
    "sleep": {
        "start": 40, "count": 8, "fps": 4, "loop": True,
        "keys": ["sleep_001", "sleep_002", "sleep_003", "sleep_004"],
        # 8帧：Zzz渐进+回退
        "sequence": [0, 1, 2, 3, 3, 2, 1, 0]
    },
    "interact": {
        "start": 48, "count": 12, "fps": 8, "loop": False,
        "keys": ["interact_001", "interact_002", "interact_003",
                 "interact_004", "interact_005", "interact_006"],
        # 12帧：惊讶→跳起→挥手→下降→落地→挥手→回退
        "sequence": [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]
    },
    "jump_fall": {
        "start": 60, "count": 8, "fps": 8, "loop": False,
        "keys": ["jump_001", "jump_002", "jump_003", "jump_004"],
        # 8帧：下蹲→起跳→下落→落地→回退
        "sequence": [0, 1, 2, 3, 3, 2, 1, 0]
    },
}


def remove_white_bg(img, threshold=240, edge_softness=2):
    """将白色背景转为透明，处理抗锯齿边缘"""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            # 判断是否接近白色
            if r > threshold and g > threshold and b > threshold:
                # 根据接近白色的程度设置透明度
                whiteness = min(r, g, b)
                alpha = int(max(0, (255 - whiteness) * (255 / (255 - threshold))))
                alpha = max(0, min(255, alpha))
                pixels[x, y] = (r, g, b, alpha)

    # 轻微边缘平滑
    if edge_softness > 0:
        alpha = img.split()[3]
        alpha = alpha.filter(ImageFilter.GaussianBlur(radius=edge_softness))
        img.putalpha(alpha)

    return img


def autocrop_and_resize(img, target_size=CELL_SIZE, padding_ratio=0.12):
    """自动裁剪到角色边界，等比缩放到目标尺寸，居中放置"""
    # 获取非透明区域边界
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    w, h = img.size
    # 计算缩放比例（留padding）
    max_dim = target_size * (1 - padding_ratio * 2)
    scale = min(max_dim / w, max_dim / h)
    new_w = int(w * scale)
    new_h = int(h * scale)

    img = img.resize((new_w, new_h), Image.LANCZOS)

    # 创建透明画布并居中
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    canvas.paste(img, (offset_x, offset_y), img)

    return canvas


def process_key_frames():
    """处理所有关键帧：去背景、裁剪、缩放"""
    processed = {}
    all_keys = set()
    for action in FRAME_MAP.values():
        all_keys.update(action["keys"])

    for key in sorted(all_keys):
        raw_path = os.path.join(RAW_DIR, f"{key}.png")
        if not os.path.exists(raw_path):
            print(f"  WARNING: {raw_path} not found, skipping")
            continue

        img = Image.open(raw_path)
        img = remove_white_bg(img, threshold=235, edge_softness=1)
        img = autocrop_and_resize(img, CELL_SIZE, padding_ratio=0.1)
        processed[key] = img
        print(f"  Processed: {key} -> {img.size}")

    return processed


def build_frame_sequences(processed):
    """根据序列映射构建完整帧序列"""
    all_frames = [None] * TOTAL_CELLS  # 72格

    for action_name, config in FRAME_MAP.items():
        action_dir = os.path.join(OUT_DIR, action_name)
        os.makedirs(action_dir, exist_ok=True)

        for i, key_idx in enumerate(config["sequence"]):
            key_name = config["keys"][key_idx]
            if key_name not in processed:
                print(f"  WARNING: key {key_name} not processed")
                # 用透明帧替代
                frame = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
            else:
                frame = processed[key_name].copy()

            cell_index = config["start"] + i
            all_frames[cell_index] = frame

            # 保存单帧
            frame_path = os.path.join(action_dir, f"{action_name}_{i+1:03d}_v1.png")
            frame.save(frame_path, "PNG")

        print(f"  {action_name}: {config['count']} frames saved")

    # 填充剩余空白格为透明
    for i in range(TOTAL_CELLS):
        if all_frames[i] is None:
            all_frames[i] = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))

    return all_frames


def assemble_sprite_sheet(all_frames):
    """组装8x9图集"""
    sheet_w = COLS * CELL_SIZE
    sheet_h = ROWS * CELL_SIZE
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    for idx, frame in enumerate(all_frames):
        col = idx % COLS
        row = idx // COLS
        x = col * CELL_SIZE
        y = row * CELL_SIZE
        sheet.paste(frame, (x, y), frame)

    output_path = os.path.join(PET_DIR, "pet.png")
    sheet.save(output_path, "PNG")
    print(f"  Sprite sheet saved: {output_path} ({sheet_w}x{sheet_h})")
    return sheet


def generate_frame_mapping():
    """生成格位映射表"""
    mapping = []
    for action_name, config in FRAME_MAP.items():
        for i in range(config["count"]):
            cell_idx = config["start"] + i
            col = cell_idx % COLS
            row = cell_idx // COLS
            mapping.append({
                "action": action_name,
                "frame_index": i,
                "cell_index": cell_idx,
                "grid_position": f"R{row+1}C{col+1}",
                "key_frame": config["keys"][config["sequence"][i]]
            })
    # 预留帧
    for cell_idx in range(68, 72):
        col = cell_idx % COLS
        row = cell_idx // COLS
        mapping.append({
            "action": "reserved",
            "frame_index": cell_idx - 68,
            "cell_index": cell_idx,
            "grid_position": f"R{row+1}C{col+1}",
            "key_frame": "transparent"
        })
    return mapping


def main():
    print("=== 步骤1: 处理关键帧（去背景+裁剪+缩放）===")
    processed = process_key_frames()

    print("\n=== 步骤2: 构建帧序列（补帧）===")
    all_frames = build_frame_sequences(processed)

    print("\n=== 步骤3: 组装8x9图集 ===")
    assemble_sprite_sheet(all_frames)

    print("\n=== 步骤4: 生成格位映射表 ===")
    mapping = generate_frame_mapping()
    mapping_path = os.path.join(PET_DIR, "frame_mapping.json")
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print(f"  Frame mapping saved: {mapping_path}")

    print("\n=== 完成 ===")
    print(f"  Total frames: {len(all_frames)}")
    print(f"  Used cells: {sum(1 for f in all_frames if f.getbbox())}")


if __name__ == "__main__":
    main()
