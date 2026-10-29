#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 2026-10-29 工作日报（Word .docx），自动内嵌 2026-10-29/images/ 下的截图。

用法:
    python3 tools/build_daily_report.py

依赖: python-docx, Pillow
    python3 -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org python-docx pillow
"""

import glob
import os
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAY = "2026-10-29"
DAY_DIR = os.path.join(BASE, DAY)
IMG_DIR = os.path.join(DAY_DIR, "images")
OUT = os.path.join(DAY_DIR, "工作日报-2026-10-29.docx")

CN_FONT = "微软雅黑"
ACCENT = RGBColor(0x2F, 0x5B, 0xD8)
GREY = RGBColor(0x66, 0x66, 0x66)


# --------------------------------------------------------------------------
# 基础排版工具
# --------------------------------------------------------------------------
def set_font(run, size=None, bold=None, color=None, cn=CN_FONT):
    run.font.name = cn
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), cn)
    rfonts.set(qn("w:ascii"), cn)
    rfonts.set(qn("w:hAnsi"), cn)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def para(doc, text="", size=10.5, bold=False, color=None, align=None,
         space_before=0, space_after=6, indent=None, line=1.45):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if indent is not None:
        pf.first_line_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    if text:
        set_font(p.add_run(text), size=size, bold=bold, color=color)
    return p


def rich(doc, parts, size=10.5, indent=0.74, space_before=0, space_after=6):
    """parts: [(text, bold, color), ...] 同段落混排。"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.45
    pf.first_line_indent = Cm(indent)
    for text, bold, color in parts:
        set_font(p.add_run(text), size=size, bold=bold, color=color)
    return p


def h1(doc, text):
    p = doc.add_paragraph(style="Heading 1")   # 用真样式，Word 导航窗格/目录可识别
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.keep_with_next = True
    set_font(p.add_run(text), size=14, bold=True, color=ACCENT)
    # 底部细线
    pPr = p._element.get_or_add_pPr()
    borders = pPr.makeelement(qn("w:pBdr"), {})
    bottom = borders.makeelement(qn("w:bottom"), {
        qn("w:val"): "single", qn("w:sz"): "6",
        qn("w:space"): "3", qn("w:color"): "2F5BD8",
    })
    borders.append(bottom)
    pPr.append(borders)
    return p


def h2(doc, text):
    p = doc.add_paragraph(style="Heading 2")
    p.paragraph_format.space_before = Pt(11)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    set_font(p.add_run(text), size=11.5, bold=True, color=RGBColor(0x1A, 0x1A, 0x1A))
    return p



def bullet(doc, text, size=10.5):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.9)
    pf.first_line_indent = Cm(-0.35)
    pf.space_before = Pt(0)
    pf.space_after = Pt(3)
    pf.line_spacing = 1.4
    set_font(p.add_run("• " + text), size=size)
    return p


def numbered(doc, idx, text, size=10.5):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(1.0)
    pf.first_line_indent = Cm(-0.45)
    pf.space_before = Pt(0)
    pf.space_after = Pt(3)
    pf.line_spacing = 1.4
    set_font(p.add_run(f"{idx}. " + text), size=size)
    return p


def shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.makeelement(qn("w:shd"), {
        qn("w:val"): "clear", qn("w:color"): "auto", qn("w:fill"): hex_color,
    })
    tcPr.append(shd)


def table(doc, headers, rows, widths=None, font_size=8.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    hdr = t.rows[0].cells
    for i, htxt in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.space_before = Pt(1)
        set_font(p.add_run(htxt), size=font_size + 0.5, bold=True,
                 color=RGBColor(0xFF, 0xFF, 0xFF))
        shade(hdr[i], "2F5BD8")
    for r_i, row in enumerate(rows):
        cells = t.add_row().cells
        for c_i, val in enumerate(row):
            cells[c_i].text = ""
            p = cells[c_i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.line_spacing = 1.15
            set_font(p.add_run(str(val)), size=font_size)
            if r_i % 2 == 1:
                shade(cells[c_i], "F2F5FD")
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def image(doc, path, caption, max_w=15.5):
    """插入截图 + 图注；文件不存在则留清晰占位。"""
    if not os.path.exists(path):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(f"［待补截图］{os.path.basename(path)}")
        set_font(r, size=9.5, bold=True, color=RGBColor(0xC0, 0x00, 0x00))
        cp = doc.add_paragraph()
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.paragraph_format.space_after = Pt(10)
        set_font(cp.add_run(caption), size=9, color=GREY)
        return False

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(path, width=Cm(max_w))

    cp = doc.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp.paragraph_format.space_after = Pt(10)
    set_font(cp.add_run(caption), size=9, color=GREY)
    return True


# --------------------------------------------------------------------------
# 正文
# --------------------------------------------------------------------------
def build():
    doc = Document()

    # 页面：A4 + 页边距
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.0)
    sec.left_margin = Cm(2.6)
    sec.right_margin = Cm(2.6)

    normal = doc.styles["Normal"]
    normal.font.name = CN_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)

    # ---------------- 标题区 ----------------
    para(doc, "AI 工程组 · 工作日报", size=9, color=GREY,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2, line=1.0)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run("2026 年 10 月 29 日（周四）"), size=20, bold=True)
    para(doc, "MCP 服务接入 · Cline Cloud 调研 · 海外 AI 免费额度清单", size=10,
         color=ACCENT, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10, line=1.2)

    table(doc,
          ["姓名", "部门 / 岗位", "填报日期", "在岗状态"],
          [["", "AI 工程组 / AI 应用工程", "2026-10-29", "正常在岗"]],
          widths=[3.6, 5.4, 3.6, 3.0], font_size=9)

    # ---------------- 0. 摘要 ----------------
    h1(doc, "一、今日工作摘要")
    para(doc,
         "今日围绕「把外部智能体能力接进生产工作流」这条主线推进三件事：一是打通 arena-bridge MCP 服务，"
         "完成协议握手、49 个工具的能力盘点与使用规则固化，并沉淀为团队可复用的接入文档；二是调研 Cline Cloud "
         "的云端代理模式，确认其「浏览器派单 → 云沙箱执行 → 边做边推分支 → 交付 PR」的工作方式；三是用 arena.ai "
         "的 Agent Mode 实跑一次真实产出，生成《海外 AI 免费额度清单（2026-10 第二部分）》。",
         indent=0.74)
    rich(doc, [
        ("完成度：", True, None),
        ("三项全部按计划完成，MCP 侧已实测可用并交付文档（1 份 157 行说明 + 1 条独立分支提交）；", False, None),
        ("遗留 1 项：", True, RGBColor(0xC0, 0x00, 0x00)),
        ("今日日报所需的 3 张过程截图需由本人从本地补入 images/ 目录后重新生成终版（正文已就绪，脚本可一键重跑）。", False, None),
    ])

    # ---------------- 1. MCP 接入 ----------------
    h1(doc, "二、主要工作内容")

    h2(doc, "2.1  MCP 服务接入与能力盘点（arena-bridge v0.5.2）")
    para(doc,
         "目标：把远端 VS Code 工作区以 MCP（Model Context Protocol）方式接入，使智能体可以直接读写代码、"
         "执行命令、驱动浏览器，而不依赖人工中转。今日完成了从握手到实测的全链路验证。", indent=0.74)

    h2(doc, "① 协议握手与连通性")
    bullet(doc, "服务端：arena-bridge v0.5.2（buildId 20261023-save-image.1），backend vscode-node，协议版本 2025-06-18。")
    bullet(doc, "传输：MCP Streamable HTTP；三次握手缺一不可 —— initialize → 取响应头 mcp-session-id → notifications/initialized → tools/call。")
    bullet(doc, "关键细节：必须带 ngrok-skip-browser-warning 请求头，否则会被隧道拦截页挡在门外；会话 ID 需在后续每个请求回带。")
    bullet(doc, "权限面：write / exec / home / network / browser 全开，意味着工具具备真实写入与执行能力，操作需谨慎。")

    h2(doc, "② 工具能力盘点：共 49 个，按用途分 9 组")
    table(doc,
          ["分组", "数量", "工具"],
          [
              ["元信息 / 工作区", "4", "bridge_info、project_info、list_workspaces、set_workspace"],
              ["浏览与读取", "7", "list_files、read_file、read_many、find_files、search_code、list_todos、open_file"],
              ["写入与编辑", "7", "write_file、edit_file、multi_edit、apply_patch、delete_file、restore_backup、save_image"],
              ["质量与诊断", "1", "get_diagnostics"],
              ["Git", "4", "git_status、git_diff、git_log、git_commit"],
              ["LSP 语义", "5", "get_symbols、go_to_definition、find_references、search_workspace_symbols、rename_symbol"],
              ["命令执行", "4", "run_command、command_output、kill_command、list_commands"],
              ["网络", "1", "web_fetch"],
              ["浏览器（CDP）", "16", "browser_status / launch / tabs / use / open / navigate / eval / text / snapshot / click / fill / press / wait / scroll / screenshot / close_tab"],
          ],
          widths=[3.3, 1.4, 10.9])
    para(doc, "说明：服务端未提供 resources 与 prompts（均返回空数组），全部能力集中在 tools 上。",
         size=9, color=GREY, indent=0.74, space_after=8)

    h2(doc, "③ 使用规则固化（12 条硬约束）")
    para(doc, "为让后续任何人接手都能一次做对，将易踩的坑写成硬约束，其中影响最大的几条：", indent=0.74)
    numbered(doc, 1, "连接后必须先 bridge_info 校验版本，避免连到缺少 save_image / regex 编辑的旧服务。")
    numbered(doc, 2, "改动闭环固定为：list_files → read_file / get_symbols → edit_file / multi_edit / apply_patch → get_diagnostics 复查；诊断只是快照，不等于构建通过，必须再用 run_command 实跑验证。")
    numbered(doc, 3, "跨文件重命名一律用 rename_symbol（LSP），禁止 search + replace 手搓；找符号用 LSP，找文本才用 search_code。")
    numbered(doc, 4, "长命令走会话机制：run_command（wait_sec ≤ 60）→ command_output（wait_ms ≤ 50000）→ 必要时 kill_command，避免卡死。")
    numbered(doc, 5, "错误不以 JSON-RPC error 返回，而是 result.isError = true 加中文文本；每次调用必须先判 isError，否则会把报错当正常输出继续跑。")
    numbered(doc, 6, "图片只能走 save_image（Base64 或公网 HTTPS，单张 ≤ 6 MiB）；未拿到返回的成功路径前不得声称已保存。")
    numbered(doc, 7, "只在本人在场且明确要求时才执行 git_commit；命令执行不是沙箱，直接落在真实机器上。")

    h2(doc, "④ 环境发现：两个必须提前知道的坑")
    rich(doc, [("坑一 · 远端目录不是 git 仓库。", True, RGBColor(0xC0, 0x00, 0x00)),
               ("git_status 直接返回 exit 128，四个 git_* 工具在该工作区全部不可用，改动没有 git 回滚兜底，"
                "只能依赖工具内置的自动备份用 restore_backup 恢复。上层流程若依赖 git 做变更管控，需要先补 git init。", False, None)])
    rich(doc, [("坑二 · 工作区其实就是 arena-bridge 自身源码。", True, RGBColor(0xC0, 0x00, 0x00)),
               ("该目录即扩展源码：src/server.ts（1652 行，工具定义在 L1233、写操作白名单在 L1315、分发 switch 在 L1339、"
                "instructions 在 L1395）、src/browser.ts（870）、src/extension.ts（448）、src/image.ts（264）、src/tunnel.ts（200）。"
                "因此修改源码不会立刻影响运行中的服务 —— 必须重新 tsc 编译并重装 vsix，否则会话里的 49 个工具行为不会变。", False, None)])

    h2(doc, "⑤ 交付物")
    bullet(doc, "docs/mcp-arena-bridge.md（157 行）：端点与握手、环境快照、返回与错误约定、12 条硬约束、49 工具清单 + 关键参数速查表、复连检查清单。")
    bullet(doc, "分支 cline/y7w3daqz，commit 01edbc8，已推送远端，可直接发起 PR 复审。")
    bullet(doc, "本地探测脚本 .mcp-probe/mcp.sh，封装 init / tools / resources / prompts / raw 五个子命令，已加入 .gitignore。")

    # ---------------- 2.2 Cline Cloud ----------------
    h2(doc, "2.2  Cline Cloud 云端代理模式调研")
    para(doc,
         "调研 Cline 新上线的 Cloud 形态，核心是判断「把任务完全交给云端沙箱」是否适合纳入我们的交付流程。", indent=0.74)
    bullet(doc, "产品定位：Cline Cloud 对所有 Cline 用户开放，主标语 “Close your laptop. Cline keeps working.”，即合上电脑任务继续跑。")
    bullet(doc, "工作方式：在浏览器里把任务交给 Cline，它在自己的云沙箱里执行，过程中持续往分支推送，最后交付一个分支或 PR 供人复审。")
    bullet(doc, "使用门槛：无需安装，浏览器即可发起，移动端可用，并提供免费模型额度。")
    bullet(doc, "对我们的启发：这与今天打通的本地 MCP 桥形成互补 —— 本地桥解决「智能体够得着我的机器」，云代理解决「机器关机了任务还在跑」。"
                "短周期、需要本地环境（内网、私钥、真实浏览器登录态）的任务仍应走本地桥；长周期、纯代码改造类任务可考虑云沙箱，"
                "两者都以「分支 / PR」作为交付边界，人始终在合并环节把关。")

    # ---------------- 2.3 arena.ai ----------------
    h2(doc, "2.3  arena.ai Agent Mode 实跑：《海外 AI 免费额度清单》第二部分")
    para(doc,
         "用 arena.ai 的 Agent Mode（本次选中模型 kimi-k3）做一次真实产出验证，产物为 overseas-ai-free-credits-2026-10-part2.md，"
         "主题是 2026 年 10 月海外 AI 工具的免费额度现状。产出结构与要点如下。", indent=0.74)

    h2(doc, "① 真正「无限量」的一档：本地 / 离线部署")
    para(doc, "Ollama、LM Studio、KoboldCpp、SillyTavern、FreedomGPT、n8n、Whisper、SD 3.5。"
              "结论是：有 GPU 的话这一档才是不受 credits 卡脖子的路径；其中 FreedomGPT 完全离线、零数据外发、无用量上限。", indent=0.74)

    h2(doc, "② 2026 年 10 月新出的五个工具")
    bullet(doc, "Lexmount：面向 agent 的云浏览器，免费 10 小时/月 + 1000 次 Web Fetch。")
    bullet(doc, "Rystic：用 Stripe / Slack 的本地副本测 agent。")
    bullet(doc, "Pomerado：把网站变成 API / MCP。")
    bullet(doc, "Ghosthand：让 agent 操作真 iPhone，7 天免费。")
    bullet(doc, "zCAD：文字转 CAD，beta 期间免费。")

    h2(doc, "③ 三个已经变了的地方（重点风险提示）")
    numbered(doc, 1, "Cursor 免费档缩水 —— 2026 年 10 月起只剩 Grok 可用。")
    numbered(doc, 2, "Kling 免费档已取消每日 credits，只剩注册赠送 + 促销，且导出必带水印。")
    numbered(doc, 3, "各榜单上的免费条数互相矛盾 —— Claude / ChatGPT 等厂商本就未公开口径，"
                     "不能按第三方数字做规划，必须自己去产品页看实时余额。")

    h2(doc, "④ AI 检索 / 深度研究工具横向对比（节选）")
    table(doc,
          ["工具", "免费情况", "亮点"],
          [
              ["Perplexity Deep Research", "5 次/天免费", "引用最充分的免费深度研究"],
              ["ChatGPT Deep Research", "免费档少量轻量运行（Pro 250 次/月）", "报告最详尽，但慢（5–30 分钟）"],
              ["Comet 浏览器", "2026-03-18 起完全免费，全平台", "可在当前阅读页面上直接跑 Deep Research"],
              ["Semantic Scholar", "全平台免费，免费 API（100 req/5min）", "索引 2 亿+ 论文，学术首选"],
              ["Elicit", "免费档可筛 4 万篇论文", "抽取结构化证据，学术综述最佳"],
              ["Consensus", "每月数次 Deep Search 免费", "同行评议文献，2.5 亿+ 论文"],
              ["Connected Papers", "每月 5 张文献图谱免费", "关系图谱可视化"],
              ["Felo", "免费档可用（Pro $9.99/月）", "跨语言检索 + AI 摘要，为差异化功能"],
              ["Exa", "有免费层", "神经检索 API，< 200ms，对 agent 友好"],
              ["Andi", "免账号、无广告", "对话式搜索"],
              ["Firecrawl", "1000 credits/月", "抓取 + 研究索引（arXiv + 代码）"],
              ["Scite", "有免费层", "检测引用幻觉（16 亿+ 引用分类）"],
          ],
          widths=[4.0, 5.6, 6.0])
    para(doc,
         "下一步待决策：是否将「通用清单」与「深度研究清单」两份合并为一份总表，或改按实际用途（写代码 / 写文案 / 出图 / 做 agent）重新裁剪一版。",
         indent=0.74)

    # ---------------- 三、问题与风险 ----------------
    h1(doc, "三、问题与风险")
    table(doc,
          ["序号", "问题", "影响", "应对措施"],
          [
              ["1", "远端工作区无 git 仓库，git_* 工具不可用", "改动无版本回滚，变更不可审计",
               "改动前依赖工具自动备份；如需长期使用建议先 git init 并建立提交规范"],
              ["2", "改源码不会即时生效（需 tsc + 重装 vsix）", "易误判「改了但没效果」",
               "变更后固定执行编译与重装，并回归验证工具清单为 49 个"],
              ["3", "MCP 会话随时可能过期", "调用中断", "脚本内置 init 子命令，失败即重建会话；关键操作幂等化"],
              ["4", "命令执行不是沙箱，权限全开", "误操作直接影响真机", "破坏性命令先确认；写入 / 删除依赖自动备份"],
              ["5", "第三方免费额度数字不可信", "按错误数字做容量规划",
               "改为以产品页实时余额为准，第三方榜单仅作线索"],
              ["6", "日报终版缺 3 张过程截图（图像字节未落入工作区）", "文档不完整",
               "将截图补入 2026-10-29/images/ 后重跑脚本，一键生成终版"],
          ],
          widths=[1.3, 5.4, 4.4, 5.5])

    # ---------------- 四、明日计划 ----------------
    h1(doc, "四、明日计划（10 月 30 日）")
    numbered(doc, 1, "补齐并归档今日 3 张过程截图，输出日报终版交部门归档。")
    numbered(doc, 2, "MCP 侧：为远端工作区补 git init 与 .gitignore，把「自动备份 + 提交规范」补齐，消除无回滚风险。")
    numbered(doc, 3, "MCP 侧：把 12 条硬约束写入团队 AGENTS 规则文件，让接手人不必读文档也能照做。")
    numbered(doc, 4, "Cline Cloud：用一个真实的小需求做端到端试点（派单 → 云沙箱 → 分支 / PR），评估是否纳入常规交付流程。")
    numbered(doc, 5, "arena.ai 产物：与需求方确认「合并总表」还是「按用途分版」，定稿后转成团队内部速查页。")

    # ---------------- 五、附件 ----------------
    h1(doc, "五、过程截图")
    para(doc, "以下截图按工作发生顺序排列，均已同步保存至 2026-10-29/images/ 目录。",
         size=9, color=GREY, indent=0.74, space_after=4)

    shots = [
        ("screenshot-01.png", "图 1　MCP 接入结论：使用规则确认与重要环境发现（arena-bridge，49 个工具）"),
        ("screenshot-02.png", "图 2　Cline Cloud 首页：Close your laptop. Cline keeps working."),
        ("screenshot-03.png", "图 3　arena.ai Agent Mode 生成《海外 AI 免费额度清单》第二部分（模型：kimi-k3）"),
    ]
    found = 0
    for name, cap in shots:
        path = os.path.join(IMG_DIR, name)
        if not os.path.exists(path):
            # 兼容其它扩展名（jpg/jpeg/webp）
            stem = os.path.splitext(name)[0]
            for ext in ("jpg", "jpeg", "png", "webp"):
                alt = os.path.join(IMG_DIR, stem + "." + ext)
                if os.path.exists(alt):
                    path = alt
                    break
            else:
                extra = sorted(glob.glob(os.path.join(IMG_DIR, stem + ".*")))
                if extra:
                    path = extra[0]
        if image(doc, path, cap):
            found += 1

    if found < len(shots):
        para(doc,
             f"注：当前目录内识别到 {found} / {len(shots)} 张截图，缺失位置以红色占位标注。"
             f"补齐 {IMG_DIR} 后执行 python3 tools/build_daily_report.py 即可重新生成本文件。",
             size=9, color=RGBColor(0xC0, 0x00, 0x00), indent=0.74)

    # ---------------- 页脚 ----------------
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(fp.add_run("2026-10-29 工作日报　·　AI 工程组"), size=8, color=GREY)

    os.makedirs(DAY_DIR, exist_ok=True)
    doc.save(OUT)
    return OUT, found


if __name__ == "__main__":
    out, found = build()
    size = os.path.getsize(out)
    print(f"[OK] {out}")
    print(f"[OK] {size:,} bytes  ({size/1024:.1f} KB)")
    print(f"[OK] 已嵌入截图 {found} / 3 张")
    if found < 3:
        print("[WARN] 截图不全，补图后重跑本脚本即可生成终版", file=sys.stderr)



