import sys
import re
from pathlib import Path

ALLOWED_VERSIONS = {"1.05","1.05.1","1.05.3","1.05.4","1.05.5","1.06","1.07","1.08","1.09"}
ALLOWED_CODEPAGES = {"852","1250"}
ALLOWED_CEL = {"0","1","2","3"}
# Поширені типи документів з таблиці: доповнюй за потреби
DOC_TYPES = {
    "FZ","FR","FS","RZ","RS","KFZ","KFS","KRZ","KRS",
    "MMW","PZ","WZ","VPZ","VWZ","PW","RW","ZW","ZD","ZK",
    "PA","FWN","FWO","KWN","KWO","FM","KFM"
}

SECTION_INFO = "[INFO]"
SECTION_HDR  = "[NAGLOWEK]"
SECTION_CNT  = "[ZAWARTOSC]"

def parse_file_lines(p: Path):
    # Зчитуємо як є, не торкаючись кодування: валідуємо структуру
    text = p.read_text(errors="replace")
    # Нормалізуємо \r\n → \n
    lines = text.replace("\r\n","\n").replace("\r","\n").split("\n")
    return lines, text

def validate_structure(lines):
    errors = []

    # 0) файл має закінчуватися пустим рядком
    if len(lines) == 0 or lines[-1] != "":
        errors.append("Файл має закінчуватись порожнім рядком (специфікація EDI++).")

    # 1) секційний порядок та наявність [INFO]
    first_nonempty = next((i for i,l in enumerate(lines) if l.strip()!=""), None)
    if first_nonempty is None:
        errors.append("Порожній файл.")
        return errors, []

    if lines[first_nonempty].strip() != SECTION_INFO:
        errors.append("Першою секцією має бути [INFO].")

    # Перевіряємо, що кожна етикетка на початку рядка і секції не порушують правил
    sec_order = []
    for i,l in enumerate(lines):
        ls = l.strip()
        if ls in (SECTION_INFO, SECTION_HDR, SECTION_CNT):
            sec_order.append((i, ls))

    # [ZAWARTOSC] не може йти без попереднього [NAGLOWEK]
    opened_hdr = False
    for idx, name in sec_order:
        if name == SECTION_INFO:
            opened_hdr = False  # INFO окрема секція-файл
        elif name == SECTION_HDR:
            opened_hdr = True
        elif name == SECTION_CNT:
            if not opened_hdr:
                errors.append(f"[ZAWARTOSC] на рядку {idx+1} без попереднього [NAGLOWEK].")
            opened_hdr = False  # після контенту очікуємо наступний блок

    return errors, sec_order

def _csv_first_record_after(section_index, lines):
    """Повертає перший CSV-рядок після етикетки секції (або None)."""
    i = section_index + 1
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    if i >= len(lines) or lines[i].startswith("["):
        return None
    return lines[i]

def _split_csv(line):
    # Проста CSV через коми, без лапок-екранів: достатньо для більшості .epp
    return [c.strip() for c in line.split(",")]

def validate_info(lines, sec_order, errors):
    # Знаходимо першу [INFO]
    for i, name in sec_order:
        if name == SECTION_INFO:
            rec = _csv_first_record_after(i, lines)
            if not rec:
                errors.append("[INFO] не містить жодного запису (рядка з полями).")
                return

            cols = _split_csv(rec)
            # Індекси за документацією (1-based у PDF, тут 0-based):
            # 0: wersja, 1: cel komunikacji, 2: strona kodowa
            if len(cols) < 3:
                errors.append("[INFO] має містити щонайменше 3 поля: wersja, cel, strona_kodowa.")
            else:
                wersja = cols[0]
                cel = cols[1]
                kodowa = cols[2]
                if wersja not in ALLOWED_VERSIONS:
                    errors.append(f"[INFO] Невірна wersja '{wersja}'. Дозволені: {sorted(ALLOWED_VERSIONS)}")
                if cel not in ALLOWED_CEL:
                    errors.append(f"[INFO] Невірний cel komunikacji '{cel}'. Дозволені: 0,1,2,3")
                if kodowa not in ALLOWED_CODEPAGES:
                    errors.append(f"[INFO] Невірна strona kodowa '{kodowa}'. Дозволені: 852 або 1250")

            # Перевіримо, якщо в [INFO] зустрінуться дати у форматі yyyymmddhhnnss → час має бути 000000
            date_like = re.findall(r"\b(\d{14})\b", ",".join(cols))
            for d in date_like:
                if d[-6:] != "000000":
                    errors.append(f"[INFO] Дата '{d}' повинна мати нульовий час (…000000).")

            return
    errors.append("Не знайдено секцію [INFO].")

def validate_headers(lines, sec_order, errors):
    # Для кожної секції [NAGLOWEK] перевіримо перше поле (тип документа)
    for i, name in sec_order:
        if name != SECTION_HDR:
            continue
        rec = _csv_first_record_after(i, lines)
        if not rec:
            errors.append(f"[NAGLOWEK] на рядку {i+1} порожній (немає записів).")
            continue
        cols = _split_csv(rec)
        if not cols:
            errors.append(f"[NAGLOWEK] на рядку {i+1} має порожній перший запис.")
            continue
        doc_type = cols[0]
        if doc_type not in DOC_TYPES:
            errors.append(f"[NAGLOWEK] на рядку {i+1}: невідомий тип документа '{doc_type}'. "
                          f"Очікується один із: {sorted(DOC_TYPES)}")

def validate_epp(path):
    p = Path(path)
    if not p.exists():
        return [f"Файл не знайдено: {p}"]

    lines, raw = parse_file_lines(p)
    errors, sec_order = validate_structure(lines)
    validate_info(lines, sec_order, errors)
    validate_headers(lines, sec_order, errors)

    return errors

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Використання: python validate_epp.py <шлях_до_файлу.epp>")
        sys.exit(2)
    errs = validate_epp(sys.argv[1])
    if errs:
        print("ПОМИЛКИ ВАЛІДАЦІЇ:")
        for e in errs:
            print(" -", e)
        sys.exit(1)
    else:
        print("OK: файл EDI++ (.epp) пройшов структурну валідацію.")

