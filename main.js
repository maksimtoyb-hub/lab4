import http from 'node:http';
import fs from 'node:fs';
import { Command } from 'commander';

// ---------- Параметри командного рядка ----------
const program = new Command();

program
  .name('lab4')
  .description('HTTP-сервер для titanic.json (варіант 6)')
  // -h за замовчуванням зайнятий довідкою, тому лишаємо довідці лише --help
  .helpOption('--help', 'показати довідку')
  .requiredOption('-i, --input <path>', 'шлях до файлу даних')
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .option('-o, --output <path>', 'файл, у який записується остання відповідь');

program.parse(process.argv);
const options = program.opts();

const port = Number(options.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Помилка: порт має бути цілим числом від 0 до 65535');
  process.exit(1);
}

// ---------- Обробка даних ----------

// Розбір вмісту файлу: NDJSON (рядок = об'єкт) або, про всяк випадок, JSON-масив.
// Помилка повертається в стилі error-first: [err, records].
function parseData(text) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return [null, []];
  }

  let records;
  try {
    if (trimmed.startsWith('[')) {
      records = JSON.parse(trimmed);
    } else {
      records = trimmed
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line));
    }
  } catch (err) {
    return [err, null];
  }

  const allObjects = Array.isArray(records) && records.every(
    (r) => r !== null && typeof r === 'object' && !Array.isArray(r)
  );
  if (!allObjects) {
    return [new Error('Записи мають бути JSON-об\'єктами'), null];
  }
  return [null, records];
}

// Перетворення значення на число; відсутнє, порожнє або нечислове -> null
function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function processRecords(records, params) {
  const onlySurvived = params.get('survived') === 'true';
  const showAge = params.get('age') === 'true';

  return records
    .filter((r) => !onlySurvived || toNumberOrNull(r.Survived) === 1)
    .map((r) => {
      const item = { name: toStringOrNull(r.Name) };
      if (showAge) item.age = toNumberOrNull(r.Age);
      item.ticket = toStringOrNull(r.Ticket);
      return item;
    });
}

// ---------- HTTP ----------

function send(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

// Помилка: пишемо в консоль сервера і відповідаємо (з записом у --output)
function respondError(res, statusCode, message) {
  console.error(`[${statusCode}] ${message}`);
  respond(res, statusCode, { error: message });
}

// Відповідь, яка за потреби спершу записується у файл --output
function respond(res, statusCode, body) {
  if (!options.output) {
    send(res, statusCode, body);
    return;
  }
  fs.writeFile(options.output, JSON.stringify(body, null, 2), 'utf8', (err) => {
    if (err) {
      // Записати не вдалося -> відповідаємо 500 напряму, без повторного запису
      const message = `Не вдалося записати файл відповіді: ${err.message}`;
      console.error(`[500] ${message}`);
      send(res, 500, { error: message });
      return;
    }
    send(res, statusCode, body);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname !== '/') {
    respondError(res, 404, `Маршрут ${url.pathname} не знайдено`);
    return;
  }

  fs.readFile(options.input, 'utf8', (err, text) => {
    if (err) {
      const message = err.code === 'ENOENT'
        ? 'Файл даних не знайдено'
        : `Не вдалося прочитати файл даних: ${err.message}`;
      respondError(res, 500, message);
      return;
    }

    const [parseErr, records] = parseData(text);
    if (parseErr) {
      respondError(res, 500, `Файл даних пошкоджений: ${parseErr.message}`);
      return;
    }

    respond(res, 200, processRecords(records, url.searchParams));
  });
}

const server = http.createServer((req, res) => {
  // Будь-яка непередбачена синхронна помилка не повинна зупиняти сервер
  try {
    handleRequest(req, res);
  } catch (err) {
    respondError(res, 500, `Внутрішня помилка сервера: ${err.message}`);
  }
});

server.on('error', (err) => {
  console.error(`Не вдалося запустити сервер: ${err.message}`);
  process.exit(1);
});

// ---------- Запуск ----------
fs.access(options.input, fs.constants.F_OK, (err) => {
  if (err) {
    console.error('Cannot find input file');
    process.exit(1);
  }
  server.listen(port, options.host, () => {
    console.log(`Сервер запущено: http://${options.host}:${port}/`);
  });
});
