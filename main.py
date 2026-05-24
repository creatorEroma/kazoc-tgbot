# -*- coding: utf-8 -*-
"""
Бот учёта заявок/сделок для компании по предоставлению ежедневной рабочей силы.

Структура:
  Наша компания (KazOC) → список компаний-клиентов (Алсер и т.д.) →
  внутри каждой компании — конкретные дни-сделки (заявки) со статус-баром.

Роли:
  * Руководитель (админ) — видит всё, админка по паролю, правит любые сделки.
  * Менеджер — видит только свои компании; правит свои сделки только в день создания.

Без ИИ. Хранилище — SQLite. Интерфейс — inline-кнопки.
"""

import asyncio
import html
import logging
import os
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (CallbackQuery, FSInputFile, InlineKeyboardButton,
                           InlineKeyboardMarkup, Message)

# ───────────────────────────── КОНФИГ ─────────────────────────────
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "1234")
HOME_NAME = os.getenv("HOME_NAME", "KazOC")          # наша головная компания
DB_PATH = os.getenv("DB_PATH", "bot_data.db")
REPORTS_DIR = os.getenv("REPORTS_DIR", "reports")


def _admin_ids():
    raw = (os.getenv("ADMIN_IDS", "") + "," + os.getenv("ADMIN_ID", "")).strip(",")
    out = set()
    for part in raw.split(","):
        part = "".join(ch for ch in part if ch.isdigit())
        if part:
            out.add(int(part))
    return out


ADMIN_IDS = _admin_ids()
os.makedirs(REPORTS_DIR, exist_ok=True)
logging.basicConfig(level=logging.INFO)

# Статусы
ST_ACCEPTED = "Принято"
ST_WORK = "В работе"
ST_WIN = "Удачная сделка"
ST_LOSS = "Неудачная сделка"
STATUS_FLOW = [ST_ACCEPTED, ST_WORK, ST_WIN]

# Периоды отчётов: код -> (подпись, дней назад от сегодня; None=всё; 0=только сегодня)
PERIODS = {
    "today": ("Сегодня", 0),
    "w": ("Неделя", 6),
    "m": ("Месяц", 29),
    "m3": ("3 месяца", 89),
    "m6": ("6 месяцев", 179),
    "m12": ("12 месяцев", 364),
    "all": ("Всё время", None),
}

# Поля сделки для редактирования: ключ -> (подпись, тип)
DEAL_FIELDS = [
    ("city", "Город", "text"),
    ("work_date", "Дата", "date"),
    ("deadline", "Срок/время", "text"),
    ("hours", "Часы работы", "num"),
    ("position", "Позиция", "text"),
    ("planned_count", "Количество (план)", "int"),
    ("work_type", "Тип работы", "text"),
    ("rate", "Ставка", "num"),
    ("client_pay", "Платят за заявку (клиент)", "num"),
    ("worker_pay", "Платят каждому работнику", "num"),
    ("company_get", "Получает компания", "num"),
    ("worker_names", "ФИО работников (смена)", "text"),
    ("final_workers", "Факт вышло работников", "int"),
    ("final_amount", "Итоговая сумма оплаты", "num"),
]

# ──────────────────────────── БАЗА ДАННЫХ ─────────────────────────

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with closing(db()) as conn, conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS managers(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE NOT NULL,
            name TEXT, username TEXT,
            role TEXT DEFAULT 'manager',
            active INTEGER DEFAULT 1,
            created_at TEXT)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS companies(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            manager_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            phone TEXT, address TEXT, contact TEXT, notes TEXT,
            created_at TEXT)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS orders(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            manager_id INTEGER NOT NULL,
            period_type TEXT DEFAULT 'current',
            city TEXT, work_date TEXT, deadline TEXT, hours REAL DEFAULT 0,
            position TEXT, planned_count INTEGER DEFAULT 0, work_type TEXT,
            rate REAL DEFAULT 0, client_pay REAL DEFAULT 0,
            worker_pay REAL DEFAULT 0, company_get REAL DEFAULT 0,
            worker_names TEXT,
            status TEXT DEFAULT 'Принято',
            final_workers INTEGER DEFAULT 0, final_amount REAL DEFAULT 0,
            notes TEXT, created_at TEXT)""")
        # лёгкая миграция (если таблица была старого формата)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(orders)")}
        add = {
            "period_type": "TEXT", "city": "TEXT", "deadline": "TEXT",
            "hours": "REAL", "position": "TEXT", "planned_count": "INTEGER",
            "rate": "REAL", "client_pay": "REAL", "worker_pay": "REAL",
            "company_get": "REAL", "worker_names": "TEXT",
            "final_workers": "INTEGER", "final_amount": "REAL",
        }
        for c, t in add.items():
            if c not in cols:
                conn.execute(f"ALTER TABLE orders ADD COLUMN {c} {t}")
        # сид руководителей
        for tid in ADMIN_IDS:
            row = conn.execute("SELECT id FROM managers WHERE telegram_id=?", (tid,)).fetchone()
            if row:
                conn.execute("UPDATE managers SET role='admin', active=1 WHERE telegram_id=?", (tid,))
            else:
                conn.execute("""INSERT INTO managers(telegram_id,name,role,active,created_at)
                                VALUES(?,?,?,1,?)""",
                             (tid, "Руководитель", "admin", datetime.now().isoformat()))


def get_user(tid):
    with closing(db()) as conn:
        return conn.execute("SELECT * FROM managers WHERE telegram_id=?", (tid,)).fetchone()


def is_allowed(u):
    return bool(u) and u["active"] == 1


def is_admin(u):
    return bool(u) and u["role"] == "admin" and u["active"] == 1


# ──────────────────────────── УТИЛИТЫ ─────────────────────────────

def esc(s):
    return html.escape(str(s)) if s not in (None, "") else "—"


def parse_date(text):
    t = (text or "").strip().lower()
    if t in ("", "сегодня", "today", "-"):
        return date.today().isoformat()
    for fmt in ("%d.%m.%Y", "%d.%m.%y", "%d.%m", "%Y-%m-%d"):
        try:
            d = datetime.strptime(t, fmt).date()
            if fmt == "%d.%m":
                d = d.replace(year=date.today().year)
            return d.isoformat()
        except ValueError:
            continue
    return None  # не распознано


def parse_num(text):
    raw = (text or "").replace(",", ".").strip()
    if raw in ("-", ""):
        return 0.0
    try:
        return float("".join(ch for ch in raw if ch.isdigit() or ch == ".") or "0")
    except ValueError:
        return 0.0


def parse_int(text):
    digits = "".join(ch for ch in (text or "") if ch.isdigit())
    return int(digits) if digits else 0


def fmt_date(iso):
    try:
        return datetime.fromisoformat(iso).strftime("%d.%m.%Y")
    except Exception:
        return iso or "—"


def money(v):
    return f"{float(v or 0):,.0f}".replace(",", " ")


def status_emoji(st):
    return {ST_ACCEPTED: "🟡", ST_WORK: "🔵", ST_WIN: "✅", ST_LOSS: "❌"}.get(st, "⚪")


def status_bar(st):
    if st == ST_LOSS:
        return "❌ <b>Неудачная сделка</b>"
    parts = []
    cur = STATUS_FLOW.index(st) if st in STATUS_FLOW else 0
    for i, s in enumerate(STATUS_FLOW):
        mark = "🟢" if i < cur else ("🔵" if i == cur else "⚪")
        label = f"<b>{s}</b>" if i == cur else s
        parts.append(f"{mark} {label}")
    return " → ".join(parts)


# ──────────────────────────── СОСТОЯНИЯ ───────────────────────────
class CompanyForm(StatesGroup):
    name = State(); phone = State(); address = State(); contact = State(); notes = State()


class DealForm(StatesGroup):
    city = State(); work_date = State(); deadline = State(); hours = State()
    position = State(); planned_count = State(); work_type = State(); rate = State()
    client_pay = State(); worker_pay = State(); company_get = State(); worker_names = State()


class CompleteForm(StatesGroup):
    final_workers = State(); final_amount = State()


class EditField(StatesGroup):
    value = State()


class AdminAuth(StatesGroup):
    password = State()


class ManagerForm(StatesGroup):
    telegram_id = State(); name = State()


class RenameManager(StatesGroup):
    name = State()


class ReportDay(StatesGroup):
    day = State()


# ──────────────────────────── КЛАВИАТУРЫ ──────────────────────────

def kb(rows):
    return InlineKeyboardMarkup(inline_keyboard=rows)


def btn(text, data):
    return InlineKeyboardButton(text=text, callback_data=data)


def main_menu(u):
    rows = [
        [btn("📋 Компании-клиенты", "co:list:0")],
        [btn("➕ Новая компания", "co:new")],
        [btn("📊 Отчёты", "rep:menu")],
    ]
    if is_admin(u):
        rows.append([btn("🔐 Админка", "adm:auth")])
    return kb(rows)


def period_kb(scope, sid, back):
    rows, line = [], []
    for code, (label, _) in PERIODS.items():
        line.append(btn(label, f"rep:go:{scope}:{sid}:{code}"))
        if len(line) == 2:
            rows.append(line); line = []
    if line:
        rows.append(line)
    rows.append([btn("📅 Конкретный день", f"rep:day:{scope}:{sid}")])
    rows.append([btn("⬅️ Назад", back)])
    return kb(rows)


# ──────────────────────────── ДОСТУП ──────────────────────────────

def companies_for(u):
    with closing(db()) as conn:
        if is_admin(u):
            return conn.execute("SELECT * FROM companies ORDER BY name").fetchall()
        return conn.execute("SELECT * FROM companies WHERE manager_id=? ORDER BY name",
                            (u["id"],)).fetchall()


def get_company(cid):
    with closing(db()) as conn:
        return conn.execute("SELECT * FROM companies WHERE id=?", (cid,)).fetchone()


def get_deal(did):
    with closing(db()) as conn:
        return conn.execute("SELECT * FROM orders WHERE id=?", (did,)).fetchone()


def can_access_company(u, c):
    return c and (is_admin(u) or c["manager_id"] == u["id"])


def can_access_deal(u, o):
    if not o:
        return False
    return is_admin(u) or o["manager_id"] == u["id"]


def can_edit_deal(u, o):
    if not o:
        return False
    if is_admin(u):
        return True
    if o["manager_id"] != u["id"]:
        return False
    return (o["created_at"] or "")[:10] == date.today().isoformat()


# ──────────────────────────── ОТЧЁТЫ XLSX ─────────────────────────

def fetch_orders(scope, sid, d_from, d_to):
    q = """SELECT o.*, c.name AS company_name, m.name AS manager_name
           FROM orders o JOIN companies c ON c.id=o.company_id
           JOIN managers m ON m.id=o.manager_id WHERE 1=1"""
    p = []
    if d_from:
        q += " AND o.work_date>=?"; p.append(d_from)
    if d_to:
        q += " AND o.work_date<=?"; p.append(d_to)
    if scope == "comp":
        q += " AND o.company_id=?"; p.append(sid)
    elif scope in ("mgr", "my"):
        q += " AND o.manager_id=?"; p.append(sid)
    q += " ORDER BY o.work_date, o.id"
    with closing(db()) as conn:
        return conn.execute(q, p).fetchall()


def period_range(code):
    _, days = PERIODS[code]
    if days is None:
        return None, None
    return (date.today() - timedelta(days=days)).isoformat(), date.today().isoformat()


def build_excel(rows, title, period_label):
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="2F5496")
    head_font = Font(bold=True, color="FFFFFF")
    money_fmt = "#,##0"

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Сводка"
    ws["A1"] = title; ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"Период: {period_label}"
    ws["A3"] = f"Сформировано: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
    ws["A4"] = f"Всего заявок: {len(rows)}"
    st_counts = {ST_ACCEPTED: 0, ST_WORK: 0, ST_WIN: 0, ST_LOSS: 0}
    for r in rows:
        st_counts[r["status"]] = st_counts.get(r["status"], 0) + 1
    ws["A5"] = (f"Статусы — Принято: {st_counts.get(ST_ACCEPTED,0)} · "
                f"В работе: {st_counts.get(ST_WORK,0)} · "
                f"Удачных: {st_counts.get(ST_WIN,0)} · "
                f"Неудачных: {st_counts.get(ST_LOSS,0)}")
    ws["A6"] = f"Факт вышло работников (итого): {sum(int(r['final_workers'] or 0) for r in rows)}"
    ws["A7"] = f"Итоговая сумма оплаты: {money(sum(float(r['final_amount'] or 0) for r in rows))}"

    by_co = {}
    for r in rows:
        d = by_co.setdefault(r["company_name"], {"o": 0, "plan": 0, "fact": 0, "cli": 0.0, "amt": 0.0})
        d["o"] += 1
        d["plan"] += int(r["planned_count"] or 0)
        d["fact"] += int(r["final_workers"] or 0)
        d["cli"] += float(r["client_pay"] or 0)
        d["amt"] += float(r["final_amount"] or 0)

    hr = 9
    heads = ["Компания", "Заявок", "План раб.", "Факт вышло", "Платят клиенты", "Итог. сумма"]
    for c, h in enumerate(heads, 1):
        cell = ws.cell(hr, c, h)
        cell.fill = head_fill; cell.font = head_font; cell.border = border
    ri = hr + 1
    for name, d in sorted(by_co.items()):
        vals = [name, d["o"], d["plan"], d["fact"], round(d["cli"]), round(d["amt"])]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(ri, c, v); cell.border = border
            if c in (5, 6):
                cell.number_format = money_fmt
        ri += 1
    for col, w in zip("ABCDEF", (32, 9, 11, 12, 16, 14)):
        ws.column_dimensions[col].width = w

    ws2 = wb.create_sheet("Заявки")
    cols = ["Дата", "Компания", "Город", "Менеджер", "Позиция", "Тип работы",
            "Период", "План кол-во", "Факт вышло", "Часы", "Ставка",
            "Платят за заявку", "Платят работнику", "Получает компания",
            "Итог. сумма", "Статус", "Срок/время", "ФИО работников", "Создано"]
    for c, h in enumerate(cols, 1):
        cell = ws2.cell(1, c, h)
        cell.fill = head_fill; cell.font = head_font; cell.border = border
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
    for i, r in enumerate(rows, start=2):
        pt = "Будущий" if r["period_type"] == "future" else "Текущий"
        vals = [fmt_date(r["work_date"]), r["company_name"], r["city"] or "",
                r["manager_name"], r["position"] or "", r["work_type"] or "", pt,
                int(r["planned_count"] or 0), int(r["final_workers"] or 0),
                float(r["hours"] or 0), round(float(r["rate"] or 0)),
                round(float(r["client_pay"] or 0)), round(float(r["worker_pay"] or 0)),
                round(float(r["company_get"] or 0)), round(float(r["final_amount"] or 0)),
                r["status"] or "", r["deadline"] or "", r["worker_names"] or "",
                (r["created_at"] or "")[:16].replace("T", " ")]
        for c, v in enumerate(vals, 1):
            cell = ws2.cell(i, c, v); cell.border = border
            if c in (11, 12, 13, 14, 15):
                cell.number_format = money_fmt
    widths = [11, 24, 13, 16, 18, 18, 9, 11, 11, 7, 10, 15, 15, 16, 13, 16, 16, 30, 17]
    for c, w in enumerate(widths, 1):
        ws2.column_dimensions[get_column_letter(c)].width = w
    ws2.freeze_panes = "A2"

    path = os.path.join(REPORTS_DIR, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx")
    wb.save(path)
    return path


# ──────────────────────────── БОТ ─────────────────────────────────
dp = Dispatcher(storage=MemoryStorage())


async def safe_edit(cq, text, markup):
    try:
        await cq.message.edit_text(text, reply_markup=markup)
    except Exception:
        await cq.message.answer(text, reply_markup=markup)


# ---------- /start, /menu ----------
@dp.message(CommandStart())
@dp.message(Command("menu"))
async def cmd_start(m: Message, state: FSMContext):
    await state.clear()
    u = get_user(m.from_user.id)
    if not is_allowed(u):
        await m.answer(
            "⛔️ <b>Доступ запрещён.</b>\n\n"
            "Ботом пользуются только руководитель и менеджеры.\n"
            f"Ваш Telegram ID: <code>{m.from_user.id}</code>\n"
            "Отправьте этот ID руководителю для добавления.")
        return
    await m.answer(
        f"🏠 <b>{esc(HOME_NAME)}</b>\n"
        f"Здравствуйте, <b>{esc(u['name'] or 'пользователь')}</b> "
        f"({'руководитель' if is_admin(u) else 'менеджер'}).\n\n"
        "Ниже — компании, которыми вы управляете:",
        reply_markup=main_menu(u))


@dp.callback_query(F.data == "menu:main")
async def to_main(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    await safe_edit(cq, f"🏠 <b>{esc(HOME_NAME)}</b>\nГлавное меню:", main_menu(u))
    await cq.answer()


# ---------- Компания ----------
@dp.callback_query(F.data == "co:new")
async def co_new(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    await state.clear(); await state.set_state(CompanyForm.name)
    await cq.message.answer("🏢 <b>Новая компания-клиент.</b>\nНазвание:")
    await cq.answer()


@dp.message(CompanyForm.name)
async def co_name(m: Message, state: FSMContext):
    await state.update_data(name=m.text.strip()); await state.set_state(CompanyForm.phone)
    await m.answer("📞 Телефон (или «-»):")


@dp.message(CompanyForm.phone)
async def co_phone(m: Message, state: FSMContext):
    await state.update_data(phone=m.text.strip()); await state.set_state(CompanyForm.address)
    await m.answer("📍 Адрес (или «-»):")


@dp.message(CompanyForm.address)
async def co_addr(m: Message, state: FSMContext):
    await state.update_data(address=m.text.strip()); await state.set_state(CompanyForm.contact)
    await m.answer("👤 Контактное лицо (или «-»):")


@dp.message(CompanyForm.contact)
async def co_contact(m: Message, state: FSMContext):
    await state.update_data(contact=m.text.strip()); await state.set_state(CompanyForm.notes)
    await m.answer("🗒 Заметки (или «-»):")


@dp.message(CompanyForm.notes)
async def co_save(m: Message, state: FSMContext):
    d = await state.get_data(); u = get_user(m.from_user.id)
    clean = lambda v: None if v in ("-", "") else v
    with closing(db()) as conn, conn:
        if d.get("edit_id"):
            conn.execute("UPDATE companies SET name=?,phone=?,address=?,contact=?,notes=? WHERE id=?",
                         (d["name"], clean(d["phone"]), clean(d["address"]),
                          clean(d["contact"]), clean(m.text.strip()), d["edit_id"]))
            cid = d["edit_id"]
        else:
            cur = conn.execute("""INSERT INTO companies(manager_id,name,phone,address,contact,notes,created_at)
                                  VALUES(?,?,?,?,?,?,?)""",
                               (u["id"], d["name"], clean(d["phone"]), clean(d["address"]),
                                clean(d["contact"]), clean(m.text.strip()), datetime.now().isoformat()))
            cid = cur.lastrowid
    await state.clear()
    await m.answer("✅ Компания сохранена.",
                   reply_markup=kb([[btn("🔎 Открыть", f"co:view:{cid}")], [btn("🏠 Меню", "menu:main")]]))


@dp.callback_query(F.data.startswith("co:list:"))
async def co_list(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    page = int(cq.data.split(":")[2]); per = 8
    items = companies_for(u)
    if not items:
        await safe_edit(cq, f"🏠 {esc(HOME_NAME)}\n\nКомпаний-клиентов пока нет.",
                        kb([[btn("➕ Новая компания", "co:new")], [btn("🏠 Меню", "menu:main")]]))
        await cq.answer(); return
    chunk = items[page * per:(page + 1) * per]
    rows = [[btn(f"🏢 {c['name']}", f"co:view:{c['id']}")] for c in chunk]
    nav = []
    if page > 0:
        nav.append(btn("⬅️", f"co:list:{page-1}"))
    if (page + 1) * per < len(items):
        nav.append(btn("➡️", f"co:list:{page+1}"))
    if nav:
        rows.append(nav)
    rows.append([btn("➕ Новая компания", "co:new"), btn("🏠 Меню", "menu:main")])
    await safe_edit(cq, f"🏠 <b>{esc(HOME_NAME)}</b>\nКомпании-клиенты ({len(items)}):", kb(rows))
    await cq.answer()


@dp.callback_query(F.data.startswith("co:view:"))
async def co_view(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    cid = int(cq.data.split(":")[2]); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    with closing(db()) as conn:
        agg = conn.execute("""SELECT COUNT(*) n,
                              COALESCE(SUM(final_workers),0) fw,
                              COALESCE(SUM(final_amount),0) fa
                              FROM orders WHERE company_id=?""", (cid,)).fetchone()
    txt = (f"🏢 <b>{esc(c['name'])}</b>\n"
           f"📞 {esc(c['phone'])}  ·  📍 {esc(c['address'])}\n"
           f"👤 {esc(c['contact'])}\n🗒 {esc(c['notes'])}\n\n"
           f"Заявок: <b>{agg['n']}</b> · вышло: <b>{agg['fw']}</b> · "
           f"оплата: <b>{money(agg['fa'])}</b>")
    rows = [
        [btn("➕ Новая заявка/сделка", f"deal:new:{cid}")],
        [btn("🧾 Текущие", f"deal:list:{cid}:current"), btn("🔜 Будущие", f"deal:list:{cid}:future")],
        [btn("📊 Отчёт по компании", f"rep:p:comp:{cid}")],
        [btn("✏️ Изменить", f"co:edit:{cid}"), btn("🗑 Удалить", f"co:del:{cid}")],
        [btn("📋 К списку", "co:list:0"), btn("🏠 Меню", "menu:main")],
    ]
    await safe_edit(cq, txt, kb(rows))
    await cq.answer()


@dp.callback_query(F.data.startswith("co:edit:"))
async def co_edit(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    cid = int(cq.data.split(":")[2]); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    await state.clear(); await state.update_data(edit_id=cid); await state.set_state(CompanyForm.name)
    await cq.message.answer(f"✏️ Изменение «{esc(c['name'])}». Новое название:")
    await cq.answer()


@dp.callback_query(F.data.startswith("co:del:"))
async def co_del(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    cid = int(cq.data.split(":")[2]); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    await safe_edit(cq, f"⚠️ Удалить «{esc(c['name'])}» и ВСЕ её заявки?",
                    kb([[btn("❌ Да, удалить", f"co:delok:{cid}")], [btn("Отмена", f"co:view:{cid}")]]))
    await cq.answer()


@dp.callback_query(F.data.startswith("co:delok:"))
async def co_delok(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    cid = int(cq.data.split(":")[2]); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    with closing(db()) as conn, conn:
        conn.execute("DELETE FROM orders WHERE company_id=?", (cid,))
        conn.execute("DELETE FROM companies WHERE id=?", (cid,))
    await safe_edit(cq, "🗑 Удалено.", kb([[btn("📋 К списку", "co:list:0")]]))
    await cq.answer()


# ---------- Список сделок компании ----------
@dp.callback_query(F.data.startswith("deal:list:"))
async def deal_list(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    _, _, cid, pt = cq.data.split(":")
    cid = int(cid); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    with closing(db()) as conn:
        ds = conn.execute("""SELECT * FROM orders WHERE company_id=? AND period_type=?
                             ORDER BY work_date DESC, id DESC LIMIT 30""", (cid, pt)).fetchall()
    title = "🧾 Текущие заявки" if pt == "current" else "🔜 Будущие заявки"
    if not ds:
        await safe_edit(cq, f"{title} — «{esc(c['name'])}»\n\nПусто.",
                        kb([[btn("➕ Новая заявка", f"deal:new:{cid}")], [btn("⬅️ Назад", f"co:view:{cid}")]]))
        await cq.answer(); return
    rows = [[btn(f"{status_emoji(o['status'])} {fmt_date(o['work_date'])} · "
                 f"{(o['position'] or o['work_type'] or 'заявка')[:18]} · {o['planned_count']}чел",
                 f"deal:view:{o['id']}")] for o in ds]
    rows.append([btn("➕ Новая заявка", f"deal:new:{cid}"), btn("⬅️ Назад", f"co:view:{cid}")])
    await safe_edit(cq, f"{title} — «{esc(c['name'])}» ({len(ds)}):", kb(rows))
    await cq.answer()


# ---------- Создание сделки ----------
@dp.callback_query(F.data.startswith("deal:new:"))
async def deal_new(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    cid = int(cq.data.split(":")[2]); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    await safe_edit(cq, f"📝 Новая заявка для «{esc(c['name'])}».\nКакой период?",
                    kb([[btn("🧾 Текущий период", f"deal:pt:{cid}:current")],
                        [btn("🔜 Будущий период", f"deal:pt:{cid}:future")],
                        [btn("⬅️ Назад", f"co:view:{cid}")]]))
    await cq.answer()


@dp.callback_query(F.data.startswith("deal:pt:"))
async def deal_pt(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    _, _, cid, pt = cq.data.split(":")
    cid = int(cid); c = get_company(cid)
    if not can_access_company(u, c):
        await cq.answer("Нет доступа", show_alert=True); return
    await state.clear()
    await state.update_data(company_id=cid, company_name=c["name"], period_type=pt)
    await state.set_state(DealForm.city)
    await cq.message.answer(f"🏢 «{esc(c['name'])}» — заполняем заявку.\n🏙 Город:")
    await cq.answer()


@dp.message(DealForm.city)
async def d_city(m: Message, state: FSMContext):
    await state.update_data(city=m.text.strip()); await state.set_state(DealForm.work_date)
    await m.answer("📅 Дата работ (ДД.ММ.ГГГГ или «сегодня»):")


@dp.message(DealForm.work_date)
async def d_date(m: Message, state: FSMContext):
    d = parse_date(m.text)
    if d is None:
        await m.answer("Не понял дату. Формат ДД.ММ.ГГГГ или «сегодня»:"); return
    await state.update_data(work_date=d); await state.set_state(DealForm.deadline)
    await m.answer("⏰ Срок/время выполнения (например «09:00–18:00» или «-»):")


@dp.message(DealForm.deadline)
async def d_deadline(m: Message, state: FSMContext):
    v = None if m.text.strip() in ("-", "") else m.text.strip()
    await state.update_data(deadline=v); await state.set_state(DealForm.hours)
    await m.answer("🕒 Сколько часов работы? (число или «-»):")


@dp.message(DealForm.hours)
async def d_hours(m: Message, state: FSMContext):
    await state.update_data(hours=parse_num(m.text)); await state.set_state(DealForm.position)
    await m.answer("📌 Позиция (кто нужен, напр. «грузчик»):")


@dp.message(DealForm.position)
async def d_position(m: Message, state: FSMContext):
    await state.update_data(position=m.text.strip()); await state.set_state(DealForm.planned_count)
    await m.answer("👷 Количество работников (план):")


@dp.message(DealForm.planned_count)
async def d_count(m: Message, state: FSMContext):
    await state.update_data(planned_count=parse_int(m.text)); await state.set_state(DealForm.work_type)
    await m.answer("🔧 Тип работы:")


@dp.message(DealForm.work_type)
async def d_type(m: Message, state: FSMContext):
    await state.update_data(work_type=m.text.strip()); await state.set_state(DealForm.rate)
    await m.answer("📊 Ставка (число или «-»):")


@dp.message(DealForm.rate)
async def d_rate(m: Message, state: FSMContext):
    await state.update_data(rate=parse_num(m.text)); await state.set_state(DealForm.client_pay)
    await m.answer("💵 Сколько платят за заявку (клиент) (или «-»):")


@dp.message(DealForm.client_pay)
async def d_clientpay(m: Message, state: FSMContext):
    await state.update_data(client_pay=parse_num(m.text)); await state.set_state(DealForm.worker_pay)
    await m.answer("👛 Сколько платят каждому работнику (или «-»):")


@dp.message(DealForm.worker_pay)
async def d_workerpay(m: Message, state: FSMContext):
    await state.update_data(worker_pay=parse_num(m.text)); await state.set_state(DealForm.company_get)
    await m.answer("🏦 Сколько получает компания (или «-»):")


@dp.message(DealForm.company_get)
async def d_companyget(m: Message, state: FSMContext):
    await state.update_data(company_get=parse_num(m.text)); await state.set_state(DealForm.worker_names)
    await m.answer("🧑‍🤝‍🧑 ФИО работников на смене (через запятую, можно позже — «-»):")


@dp.message(DealForm.worker_names)
async def d_save(m: Message, state: FSMContext):
    d = await state.get_data(); u = get_user(m.from_user.id)
    names = None if m.text.strip() in ("-", "") else m.text.strip()
    with closing(db()) as conn, conn:
        cur = conn.execute("""INSERT INTO orders(company_id,manager_id,period_type,city,work_date,
            deadline,hours,position,planned_count,work_type,rate,client_pay,worker_pay,
            company_get,worker_names,status,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (d["company_id"], u["id"], d["period_type"], d["city"], d["work_date"],
             d["deadline"], d["hours"], d["position"], d["planned_count"], d["work_type"],
             d["rate"], d["client_pay"], d["worker_pay"], d["company_get"], names,
             ST_ACCEPTED, datetime.now().isoformat()))
        did = cur.lastrowid
    await state.clear()
    text, markup = render_deal(get_deal(did), u)
    await m.answer("✅ Заявка создана.\n\n" + text, reply_markup=markup)


# ---------- Карточка сделки ----------
def render_deal(o, u):
    c = get_company(o["company_id"])
    pt = "Будущий" if o["period_type"] == "future" else "Текущий"
    txt = (
        f"{status_emoji(o['status'])} <b>Заявка #{o['id']}</b> · {pt} период\n"
        f"{status_bar(o['status'])}\n\n"
        f"🏢 {esc(c['name'] if c else '—')}\n"
        f"🏙 Город: {esc(o['city'])}\n"
        f"📅 Дата: {fmt_date(o['work_date'])}  ⏰ {esc(o['deadline'])}  🕒 {o['hours'] or 0}ч\n"
        f"📌 Позиция: {esc(o['position'])}  ·  🔧 {esc(o['work_type'])}\n"
        f"👷 План: {o['planned_count'] or 0}  ·  📊 Ставка: {money(o['rate'])}\n"
        f"💵 Платит клиент: {money(o['client_pay'])}\n"
        f"👛 Работнику: {money(o['worker_pay'])}  ·  🏦 Компании: {money(o['company_get'])}\n"
        f"🧑‍🤝‍🧑 ФИО: {esc(o['worker_names'])}\n"
    )
    if o["status"] == ST_WIN:
        txt += (f"\n🏁 <b>Факт вышло: {o['final_workers'] or 0}</b>  ·  "
                f"<b>Сумма оплаты: {money(o['final_amount'])}</b>\n")
    st_rows = []
    if o["status"] == ST_ACCEPTED:
        st_rows = [[btn("▶️ В работу", f"deal:st:{o['id']}:work"),
                    btn("❌ Неудачная", f"deal:st:{o['id']}:loss")]]
    elif o["status"] == ST_WORK:
        st_rows = [[btn("✅ Завершить (удачно)", f"deal:st:{o['id']}:win")],
                   [btn("❌ Неудачная", f"deal:st:{o['id']}:loss")]]
    elif o["status"] in (ST_WIN, ST_LOSS):
        st_rows = [[btn("↩️ Вернуть в работу", f"deal:st:{o['id']}:reopen")]]
    rows = list(st_rows)
    if can_edit_deal(u, o):
        rows.append([btn("✏️ Редактировать", f"deal:edit:{o['id']}"),
                     btn("🗑 Удалить", f"deal:rm:{o['id']}")])
    rows.append([btn("⬅️ К компании", f"co:view:{o['company_id']}")])
    return txt, kb(rows)


@dp.callback_query(F.data.startswith("deal:view:"))
async def deal_view(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    o = get_deal(int(cq.data.split(":")[2]))
    if not can_access_deal(u, o):
        await cq.answer("Нет доступа", show_alert=True); return
    text, markup = render_deal(o, u)
    await safe_edit(cq, text, markup)
    await cq.answer()


# ---------- Смена статуса ----------
@dp.callback_query(F.data.startswith("deal:st:"))
async def deal_status(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    _, _, did, action = cq.data.split(":")
    did = int(did); o = get_deal(did)
    if not can_access_deal(u, o):
        await cq.answer("Нет доступа", show_alert=True); return
    if action == "win":
        await state.clear(); await state.update_data(deal_id=did)
        await state.set_state(CompleteForm.final_workers)
        await cq.message.answer("🏁 Завершение сделки.\nСколько работников фактически вышло?")
        await cq.answer(); return
    new = {"work": ST_WORK, "loss": ST_LOSS, "reopen": ST_WORK}[action]
    with closing(db()) as conn, conn:
        conn.execute("UPDATE orders SET status=? WHERE id=?", (new, did))
    await cq.answer("Статус обновлён")
    text, markup = render_deal(get_deal(did), u)
    await safe_edit(cq, text, markup)


@dp.message(CompleteForm.final_workers)
async def cf_workers(m: Message, state: FSMContext):
    await state.update_data(final_workers=parse_int(m.text))
    await state.set_state(CompleteForm.final_amount)
    await m.answer("💰 Итоговая сумма оплаты:")


@dp.message(CompleteForm.final_amount)
async def cf_amount(m: Message, state: FSMContext):
    d = await state.get_data(); u = get_user(m.from_user.id)
    with closing(db()) as conn, conn:
        conn.execute("UPDATE orders SET status=?, final_workers=?, final_amount=? WHERE id=?",
                     (ST_WIN, d["final_workers"], parse_num(m.text), d["deal_id"]))
    await state.clear()
    text, markup = render_deal(get_deal(d["deal_id"]), u)
    await m.answer("✅ Сделка завершена (удачная).\n\n" + text, reply_markup=markup)


# ---------- Редактирование полей сделки ----------
@dp.callback_query(F.data.startswith("deal:edit:"))
async def deal_edit(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    did = int(cq.data.split(":")[2]); o = get_deal(did)
    if not can_edit_deal(u, o):
        await cq.answer("Редактировать нельзя: либо не ваша, либо прошёл день создания.",
                        show_alert=True); return
    rows, line = [], []
    for key, label, _ in DEAL_FIELDS:
        line.append(btn(label, f"deal:ef:{did}:{key}"))
        if len(line) == 2:
            rows.append(line); line = []
    if line:
        rows.append(line)
    rows.append([btn("⬅️ Назад", f"deal:view:{did}")])
    await safe_edit(cq, "✏️ Что изменить?", kb(rows))
    await cq.answer()


@dp.callback_query(F.data.startswith("deal:ef:"))
async def deal_edit_field(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    _, _, did, key = cq.data.split(":")
    did = int(did); o = get_deal(did)
    if not can_edit_deal(u, o):
        await cq.answer("Нельзя редактировать", show_alert=True); return
    label = next((l for k, l, _ in DEAL_FIELDS if k == key), key)
    await state.clear(); await state.update_data(deal_id=did, field=key)
    await state.set_state(EditField.value)
    await cq.message.answer(f"Введите новое значение — <b>{esc(label)}</b>:")
    await cq.answer()


@dp.message(EditField.value)
async def edit_field_save(m: Message, state: FSMContext):
    d = await state.get_data(); u = get_user(m.from_user.id)
    o = get_deal(d["deal_id"])
    if not can_edit_deal(u, o):
        await state.clear(); await m.answer("Редактирование недоступно."); return
    key = d["field"]
    ftype = next((t for k, _, t in DEAL_FIELDS if k == key), "text")
    if ftype == "date":
        val = parse_date(m.text)
        if val is None:
            await m.answer("Неверная дата, формат ДД.ММ.ГГГГ:"); return
    elif ftype == "int":
        val = parse_int(m.text)
    elif ftype == "num":
        val = parse_num(m.text)
    else:
        val = None if m.text.strip() in ("-", "") else m.text.strip()
    with closing(db()) as conn, conn:
        conn.execute(f"UPDATE orders SET {key}=? WHERE id=?", (val, d["deal_id"]))
    await state.clear()
    text, markup = render_deal(get_deal(d["deal_id"]), u)
    await m.answer("✅ Обновлено.\n\n" + text, reply_markup=markup)


@dp.callback_query(F.data.startswith("deal:rm:"))
async def deal_rm(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    did = int(cq.data.split(":")[2]); o = get_deal(did)
    if not can_edit_deal(u, o):
        await cq.answer("Удалять нельзя", show_alert=True); return
    await safe_edit(cq, f"⚠️ Удалить заявку #{did}?",
                    kb([[btn("❌ Да", f"deal:rmok:{did}")], [btn("Отмена", f"deal:view:{did}")]]))
    await cq.answer()


@dp.callback_query(F.data.startswith("deal:rmok:"))
async def deal_rmok(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    did = int(cq.data.split(":")[2]); o = get_deal(did)
    if not can_edit_deal(u, o):
        await cq.answer("Нельзя", show_alert=True); return
    cid = o["company_id"]
    with closing(db()) as conn, conn:
        conn.execute("DELETE FROM orders WHERE id=?", (did,))
    await safe_edit(cq, "🗑 Заявка удалена.", kb([[btn("⬅️ К компании", f"co:view:{cid}")]]))
    await cq.answer()


# ---------- Отчёты ----------
@dp.callback_query(F.data == "rep:menu")
async def rep_menu(cq: CallbackQuery, state: FSMContext):
    await state.clear()
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    if is_admin(u):
        rows = [[btn("🌐 Общий (все)", "rep:p:all:0")],
                [btn("👤 По менеджеру", "rep:list:mgr")],
                [btn("🏢 По компании", "rep:list:comp")],
                [btn("🏠 Меню", "menu:main")]]
        await safe_edit(cq, "📊 Какой отчёт?", kb(rows))
    else:
        await safe_edit(cq, "📊 Отчёт по вашим компаниям. Период:",
                        period_kb("my", u["id"], "menu:main"))
    await cq.answer()


@dp.callback_query(F.data.startswith("rep:list:"))
async def rep_list(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    kind = cq.data.split(":")[2]
    with closing(db()) as conn:
        if kind == "mgr":
            items = conn.execute("SELECT id,name,telegram_id FROM managers ORDER BY name").fetchall()
            rows = [[btn(f"👤 {x['name'] or x['telegram_id']}", f"rep:p:mgr:{x['id']}")] for x in items]
        else:
            items = conn.execute("SELECT id,name FROM companies ORDER BY name").fetchall()
            rows = [[btn(f"🏢 {x['name']}", f"rep:p:comp:{x['id']}")] for x in items[:80]]
    rows.append([btn("⬅️ Назад", "rep:menu")])
    await safe_edit(cq, "Выберите объект:", kb(rows))
    await cq.answer()


@dp.callback_query(F.data.startswith("rep:p:"))
async def rep_pick_period(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    _, _, scope, sid = cq.data.split(":"); sid = int(sid)
    if scope in ("all", "mgr") and not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    if scope == "comp" and not can_access_company(u, get_company(sid)):
        await cq.answer("Нет доступа", show_alert=True); return
    await safe_edit(cq, "Период отчёта:", period_kb(scope, sid, "rep:menu"))
    await cq.answer()


@dp.callback_query(F.data.startswith("rep:day:"))
async def rep_day(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    _, _, scope, sid = cq.data.split(":")
    await state.clear(); await state.update_data(scope=scope, sid=int(sid))
    await state.set_state(ReportDay.day)
    await cq.message.answer("📅 За какой день отчёт? (ДД.ММ.ГГГГ):")
    await cq.answer()


@dp.message(ReportDay.day)
async def rep_day_go(m: Message, state: FSMContext):
    d = await state.get_data(); u = get_user(m.from_user.id)
    day = parse_date(m.text)
    await state.clear()
    if day is None:
        await m.answer("Неверная дата."); return
    scope, sid = d["scope"], d["sid"]
    if scope == "my":
        sid = u["id"]
    rows = fetch_orders(scope, sid, day, day)
    await deliver_report(m, u, rows, scope, sid, f"День {fmt_date(day)}")


@dp.callback_query(F.data.startswith("rep:go:"))
async def rep_go(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_allowed(u):
        await cq.answer("Доступ запрещён", show_alert=True); return
    _, _, scope, sid, period = cq.data.split(":"); sid = int(sid)
    if scope in ("all", "mgr") and not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    if scope == "comp" and not can_access_company(u, get_company(sid)):
        await cq.answer("Нет доступа", show_alert=True); return
    if scope == "my":
        sid = u["id"]
    await cq.answer("Формирую…")
    d_from, d_to = period_range(period)
    rows = fetch_orders(scope, sid, d_from, d_to)
    await deliver_report(cq.message, u, rows, scope, sid, PERIODS[period][0])


async def deliver_report(target, u, rows, scope, sid, plabel):
    if scope == "all":
        title = "Общий отчёт по всем компаниям"
    elif scope == "comp":
        title = f"Отчёт по компании: {get_company(sid)['name']}"
    elif scope == "mgr":
        with closing(db()) as conn:
            mn = conn.execute("SELECT name,telegram_id FROM managers WHERE id=?", (sid,)).fetchone()
        title = f"Отчёт по менеджеру: {mn['name'] or mn['telegram_id']}"
    else:
        title = "Отчёт по моим компаниям"
    if not rows:
        await target.answer(f"За период «{plabel}» данных нет."); return
    path = build_excel(rows, title, plabel)
    await target.answer_document(FSInputFile(path),
                                 caption=f"📊 {title}\nПериод: {plabel}\nЗаявок: {len(rows)}")


# ---------- Админка ----------
@dp.callback_query(F.data == "adm:auth")
async def adm_auth(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Только для руководителя", show_alert=True); return
    await state.set_state(AdminAuth.password)
    await cq.message.answer("🔐 Пароль администратора:")
    await cq.answer()


@dp.message(AdminAuth.password)
async def adm_check(m: Message, state: FSMContext):
    await state.clear(); u = get_user(m.from_user.id)
    if not is_admin(u):
        await m.answer("Доступ запрещён."); return
    if m.text.strip() != ADMIN_PASSWORD:
        await m.answer("❌ Неверный пароль. Вы остаётесь менеджером.", reply_markup=main_menu(u)); return
    await m.answer("✅ Админка открыта.", reply_markup=admin_menu())


def admin_menu():
    return kb([[btn("👥 Менеджеры", "adm:mgrs")],
               [btn("📊 Отчёты", "rep:menu")],
               [btn("🚪 Выйти", "menu:main")]])


@dp.callback_query(F.data == "adm:mgrs")
async def adm_mgrs(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    with closing(db()) as conn:
        ms = conn.execute("SELECT * FROM managers ORDER BY role DESC, name").fetchall()
    rows = []
    for x in ms:
        flag = "👑" if x["role"] == "admin" else ("🟢" if x["active"] else "🔴")
        rows.append([btn(f"{flag} {x['name'] or x['telegram_id']}", f"adm:mgr:{x['id']}")])
    rows.append([btn("➕ Добавить менеджера", "adm:add")])
    rows.append([btn("⬅️ Назад", "adm:back")])
    await safe_edit(cq, "👥 <b>Менеджеры и руководители</b>\n🟢 активен · 🔴 откл. · 👑 руководитель", kb(rows))
    await cq.answer()


@dp.callback_query(F.data == "adm:back")
async def adm_back(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    await safe_edit(cq, "Админка:", admin_menu()); await cq.answer()


@dp.callback_query(F.data.startswith("adm:mgr:"))
async def adm_mgr_view(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    mid = int(cq.data.split(":")[2])
    with closing(db()) as conn:
        x = conn.execute("SELECT * FROM managers WHERE id=?", (mid,)).fetchone()
        nco = conn.execute("SELECT COUNT(*) n FROM companies WHERE manager_id=?", (mid,)).fetchone()["n"]
        admins = conn.execute("SELECT COUNT(*) n FROM managers WHERE role='admin' AND active=1").fetchone()["n"]
    if not x:
        await cq.answer("Не найдено", show_alert=True); return
    txt = (f"👤 <b>{esc(x['name'])}</b>\nID: <code>{x['telegram_id']}</code>\n"
           f"Роль: {x['role']} · {'активен' if x['active'] else 'отключён'}\nКомпаний: {nco}")
    rows = []
    if x["role"] == "admin":
        if admins > 1:
            rows.append([btn("🙍 Сделать менеджером", f"adm:role:{mid}:manager")])
    else:
        rows.append([btn("👑 Сделать руководителем", f"adm:role:{mid}:admin")])
        if x["active"]:
            rows.append([btn("🔴 Отключить", f"adm:toggle:{mid}:0")])
        else:
            rows.append([btn("🟢 Включить", f"adm:toggle:{mid}:1")])
        rows.append([btn("✏️ Переименовать", f"adm:ren:{mid}")])
    rows.append([btn("📊 Отчёт по менеджеру", f"rep:p:mgr:{mid}")])
    rows.append([btn("⬅️ К списку", "adm:mgrs")])
    await safe_edit(cq, txt, kb(rows))
    await cq.answer()


@dp.callback_query(F.data.startswith("adm:role:"))
async def adm_role(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    _, _, mid, role = cq.data.split(":")
    with closing(db()) as conn, conn:
        conn.execute("UPDATE managers SET role=?, active=1 WHERE id=?", (role, int(mid)))
    await cq.answer("Роль изменена")
    cq.data = f"adm:mgr:{mid}"
    await adm_mgr_view(cq)


@dp.callback_query(F.data.startswith("adm:toggle:"))
async def adm_toggle(cq: CallbackQuery):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    _, _, mid, val = cq.data.split(":")
    with closing(db()) as conn, conn:
        conn.execute("UPDATE managers SET active=? WHERE id=? AND role!='admin'", (int(val), int(mid)))
    await cq.answer("Готово")
    cq.data = f"adm:mgr:{mid}"
    await adm_mgr_view(cq)


@dp.callback_query(F.data.startswith("adm:ren:"))
async def adm_ren(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    mid = int(cq.data.split(":")[2])
    await state.set_state(RenameManager.name); await state.update_data(mid=mid)
    await cq.message.answer("Новое имя менеджера:")
    await cq.answer()


@dp.message(RenameManager.name)
async def adm_ren_save(m: Message, state: FSMContext):
    u = get_user(m.from_user.id)
    if not is_admin(u):
        await state.clear(); return
    d = await state.get_data(); await state.clear()
    with closing(db()) as conn, conn:
        conn.execute("UPDATE managers SET name=? WHERE id=?", (m.text.strip(), d["mid"]))
    await m.answer("✅ Имя обновлено.", reply_markup=kb([[btn("👥 К менеджерам", "adm:mgrs")]]))


@dp.callback_query(F.data == "adm:add")
async def adm_add(cq: CallbackQuery, state: FSMContext):
    u = get_user(cq.from_user.id)
    if not is_admin(u):
        await cq.answer("Нет доступа", show_alert=True); return
    await state.set_state(ManagerForm.telegram_id)
    await cq.message.answer("➕ Telegram ID нового менеджера (число).\n"
                            "Он узнаёт свой ID, написав боту /start.")
    await cq.answer()


@dp.message(ManagerForm.telegram_id)
async def adm_add_id(m: Message, state: FSMContext):
    u = get_user(m.from_user.id)
    if not is_admin(u):
        await state.clear(); return
    digits = "".join(ch for ch in m.text if ch.isdigit())
    if not digits:
        await m.answer("Нужно число — Telegram ID:"); return
    await state.update_data(tid=int(digits)); await state.set_state(ManagerForm.name)
    await m.answer("Имя менеджера:")


@dp.message(ManagerForm.name)
async def adm_add_name(m: Message, state: FSMContext):
    u = get_user(m.from_user.id)
    if not is_admin(u):
        await state.clear(); return
    d = await state.get_data(); await state.clear()
    try:
        with closing(db()) as conn, conn:
            conn.execute("""INSERT INTO managers(telegram_id,name,role,active,created_at)
                            VALUES(?,?,?,1,?)""",
                         (d["tid"], m.text.strip(), "manager", datetime.now().isoformat()))
        await m.answer(f"✅ Менеджер «{esc(m.text.strip())}» добавлен.",
                       reply_markup=kb([[btn("👥 К менеджерам", "adm:mgrs")]]))
    except sqlite3.IntegrityError:
        await m.answer("Этот ID уже есть в системе.",
                       reply_markup=kb([[btn("👥 К менеджерам", "adm:mgrs")]]))


# ---------- Фоллбэк ----------
@dp.message(StateFilter(None))
async def fallback(m: Message):
    u = get_user(m.from_user.id)
    if not is_allowed(u):
        await m.answer(f"⛔️ Доступ запрещён. Ваш ID: <code>{m.from_user.id}</code>"); return
    await m.answer("Откройте меню:", reply_markup=main_menu(u))


# ──────────────────────────── ЗАПУСК ──────────────────────────────
async def main():
    if not BOT_TOKEN:
        raise SystemExit("Не задан BOT_TOKEN.")
    init_db()
    bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    print("Бот запущен.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
