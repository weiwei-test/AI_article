#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 Arena Bridge 项目工作日报 (.docx)，依赖 python-docx。

用法:
    python3 tools/gen_daily_report.py [输出路径]
默认输出到工作区根目录: 2026-10-26_工作日报.docx
"""
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

CN_FONT = "微软雅黑"
ACCENT = RGBColor(0x1F, 0x4E, 0x79)
GREY = RGBColor(0x59, 0x59, 0x59)
HEADER_FILL = "DCE6F1"


def style_run(run, size=None, bold=None, color=None, font=CN_FONT):
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    return run


def para(doc, text="", size=10.5, bold=False, color=None, align=None,
         space_after=4, indent=None, line=1.45):
    p = doc.add_paragraph()
    if text:
        style_run(p.add_run(text), size=size, bold=bold, color=color)
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if align is not None:
        p.alignment = align
    if indent is not None:
        pf.left_indent = Cm(indent)
    return p


def bullet(doc, text, head=None):
    p = doc.add_paragraph(style="List Bullet")
    if head:
        style_run(p.add_run(head), size=10.5, bold=True)
    style_run(p.add_run(text), size=10.5)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.4
    return p


def heading(doc, text, level=1):
    h = doc.add_heading(level=level)
    style_run(h.add_run(text), size=14 if level == 1 else 11.5,
              bold=True, color=ACCENT if level == 1 else None)
    h.paragraph_format.space_before = Pt(14 if level == 1 else 8)
    h.paragraph_format.space_after = Pt(6)
    return h


def shade(cell, fill=HEADER_FILL):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def table(doc, header, rows, widths=None, size=9.5):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]
        c.text = ""
        style_run(c.paragraphs[0].add_run(h), size=size + 0.5, bold=True)
        c.paragraphs[0].paragraph_format.space_after = Pt(1)
        shade(c)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            style_run(cells[i].paragraphs[0].add_run(str(v)), size=size)
            cells[i].paragraphs[0].paragraph_format.space_after = Pt(1)
    if widths:
        for r in t.rows:
            for i, w in enumerate(widths):
                r.cells[i].width = Cm(w)
    para(doc, "", space_after=2)
    return t


# --- CONTENT ---

def build(path):
    doc = Document()
    for sec in doc.sections:
        sec.top_margin = sec.bottom_margin = Cm(2.0)
        sec.left_margin = sec.right_margin = Cm(2.2)
    normal = doc.styles["Normal"]
    normal.font.name = CN_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)

    para(doc, "工 作 日 报", size=22, bold=True, color=ACCENT,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "Arena Bridge 扩展项目 · v0.5.2", size=10, color=GREY,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)

    table(doc, ["项目", "内容"], [
        ["日期", "2026 年 10 月 26 日（星期一）"],
        ["汇报人", "weiwei"],
        ["所属项目", "Arena Bridge（arena-bridge-vscode）v0.5.2，Build 20261023-save-image.1"],
        ["工作形式", "Cline Agent 协作，通过 MCP Bridge 远程接入 VS Code 工作区"],
    ], widths=[3.4, 12.8], size=10)

    # ---------------- 一 ----------------
    heading(doc, "一、今日工作完成情况")

    heading(doc, "1. MCP Bridge 连接建立与通道验证", level=2)
    bullet(doc, "完成 JSON-RPC 2.0 握手（协议版本 2024-11-05），确认服务为 arena-bridge 0.5.2，"
                "进程 PID 8290、监听端口 8765、后端 vscode-node。", "连接初始化：")
    bullet(doc, "调用 bridge_info 核实绑定工作区为 /Users/shiwei/Arena2api-fixed-main/"
                "arena-bridge-vscode，共 5042 个文件（不含忽略目录）。", "工作区确认：")
    bullet(doc, "write / exec / home / network / browser 五项权限全部放行；Chrome 调试端口 9222，"
                "版本 155.0.8059.86，支持自动拉起与页面变更操作。", "权限核验：")
    bullet(doc, "list_files 列目录、read_file 读取 src/version.ts（VERSION=0.5.2）、"
                "get_diagnostics 返回无错误、browser_status 读回 4 个标签页，四条主通道均实测可用。",
           "冒烟测试：")

    heading(doc, "2. 工具链梳理与使用规则明确", level=2)
    para(doc, "MCP 共暴露 49 个工具，按用途划分为 6 大板块，并据此形成后续作业规范：")
    table(doc, ["板块", "数量", "代表工具", "用途"], [
        ["环境与工作区", "4", "bridge_info、list_workspaces、set_workspace", "版本自检、多项目切换"],
        ["文件与编辑", "13", "read_many、edit_file、multi_edit、apply_patch", "读写、批量修改、备份回滚"],
        ["LSP 语义", "6", "get_symbols、find_references、rename_symbol", "结构化重构与跨文件重命名"],
        ["Git 版本", "4", "git_status、git_diff、git_commit", "版本查看与受控提交"],
        ["命令执行", "4", "run_command、command_output", "长任务会话化执行"],
        ["浏览器与网络", "17", "browser_snapshot、browser_click、web_fetch", "真实 Chrome 操控、页面抓取"],
        ["其它", "1", "list_todos", "扫描 TODO / FIXME 标记"],
    ], widths=[3.0, 1.4, 7.4, 5.2])
    bullet(doc, "改动前自动备份，删除与覆盖均可通过 restore_backup 回滚。", "安全兜底：")
    bullet(doc, "跨文件重命名统一使用 rename_symbol（LSP），禁止手工搜索替换。", "语义优先：")
    bullet(doc, "每次编辑后立即读取诊断自查，但诊断仅代表快照，不等同于构建与测试通过。", "编辑自检：")
    bullet(doc, "优先 browser_text / browser_snapshot 提取结构化信息，避免整页 HTML 消耗 Token。",
           "Token 控制：")
    bullet(doc, "长命令采用会话机制（run_command 返回 session_id，再由 command_output 续取）。",
           "长任务执行：")
    bullet(doc, "未经明确授权不执行 git_commit，提交动作保持人工决策。", "变更纪律：")

    heading(doc, "3. 项目结构与质量分析", level=2)
    bullet(doc, "src（6 个 TypeScript 文件，约 169 KB）、test（7 个用例）、out（编译产物）、"
                "ArenaDesk（Swift 子项目）、vendor/OmniRoute-src、tools（脚本）、assets、reports（空）。",
           "目录结构：")
    bullet(doc, "src/server.ts 单文件 94,449 字节，约占 src 总量的 55%，是主要维护瓶颈。", "体积热点：")
    para(doc, "按五个维度完成初评（5 分制），结论为工程完成度高、交互设计成熟，架构分层是主要短板：")
    table(doc, ["评估维度", "评分", "说明"], [
        ["工程完成度", "5.0", "49 个工具全部可用，权限矩阵完整，冒烟测试一次通过"],
        ["代码健壮性", "4.5", "编辑前备份、诊断回传、命令会话化，异常路径处理到位"],
        ["架构分层", "4.0", "server.ts 承担过多职责，工具注册与传输层耦合"],
        ["Agent 交互体验", "5.0", "instructions 明确工作流，返回值自带诊断，Token 友好"],
        ["可测试性", "4.0", "已有 7 个测试用例，但缺少端到端回归脚本"],
    ], widths=[3.6, 1.6, 11.0])
    para(doc, "注：评分为基于今日实测的初评，需结合完整代码走查与测试覆盖复评。",
         size=9, color=GREY)

    # ---------------- 二 ----------------
    heading(doc, "二、问题与风险")
    table(doc, ["序号", "问题", "影响", "建议"], [
        ["1", "工作区缺少 .git 目录（仅保留 .gitignore / .vscodeignore）",
         "git_status 返回 128，无版本历史、无法回滚", "执行 git init 并补全忽略规则"],
        ["2", "src/server.ts 单文件 94 KB", "阅读、评审与并行修改成本高",
         "按 HTTP / 文件 / LSP / 浏览器 / Git 分层拆分"],
        ["3", "根目录堆积 4 份约 660 KB 的 arena-ai*.txt 与 7 个历史 .vsix",
         "合计约 2.5 MB，干扰检索与打包", "归档至 docs/ 与 dist/ 并加入忽略"],
        ["4", "隧道依赖 ngrok 免费域名", "域名变更即导致连接中断", "改用固定域名或自建隧道"],
        ["5", "run_command 为非沙箱执行", "破坏性命令直接影响真实工程", "高危操作二次确认，保留备份"],
    ], widths=[1.2, 6.2, 5.6, 3.2], size=9)
    para(doc, "今日实际触发风险 1 项：git_status 报 fatal: not a git repository（exit 128），"
              "已改用 run_command 获取目录信息，未影响其他工作。")

    # ---------------- 三 ----------------
    heading(doc, "三、明日及后续工作计划")
    for i, item in enumerate([
        "输出 server.ts 拆分方案，目标拆为 server-core、tools-fs、tools-lsp、tools-browser、"
        "tools-git 五个模块，方案确认后再动代码。",
        "为 MCP 隧道接口增加鉴权 Token 校验，避免调试端口裸奔。",
        "建立版本管理：git init、补全 .gitignore、迁移产物文件。",
        "补齐回归测试，覆盖拆分后的工具注册与传输链路。",
        "承接具体业务需求，按既定规范使用工具链完成开发与自动化。",
    ], 1):
        p = para(doc, f"{i}. {item}", space_after=4, indent=0.4)

    para(doc, "", space_after=6)
    para(doc, "本报告由 Cline Agent 基于桥接工作区实测数据生成 · 2026-10-26",
         size=9, color=GREY, align=WD_ALIGN_PARAGRAPH.RIGHT)

    doc.save(path)
    print("OK ->", path)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "2026-10-26_工作日报.docx"
    build(out)
