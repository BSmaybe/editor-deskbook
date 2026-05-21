# DeskBook Go API

Go-бэкенд редактора карт DeskBook: авторизация, приглашения, здания, этажи, компоненты, блоки, шаблоны, рабочие места, layout draft/publish, SVG-импорт и семантический SVG/HTML экспорт.

## Структура пакетов

```
cmd/server/          — точка входа: slog-логгер, pgxpool, goose-миграции, graceful shutdown
internal/
  handler/           — HTTP-хендлеры: handler.go регистрирует все маршруты через NewServer()
  store/             — CRUD-обёртки: ComponentStore, LayoutStore, UserStore, ...
  store/db/          — sqlc-генерированный код (Querier, модели, SQL-методы)
  store/queries/     — SQL-шаблоны для sqlc
  auth/              — JWT-утилиты (HS256, claims sub/role/exp)
  exporter/          — layout_json → семантический SVG/HTML
  svgimport/         — SVG-импорт и классификация элементов (стены, двери, рабочие места)
migrations/          — SQL-файлы goose (embedded в бинарник через migrations.go)
```

## Контракт экспорта

- **Вход**: `layout_json` (структура `LayoutDocument`).
- **SVG**: семантический SVG/XML — `<defs>/<symbol>`, слои `background`, `structure`, `building/storey/zone/workplace`, атрибуты `data-*`, переиспользуемые `<use>`-ссылки.
- **HTML**: standalone HTML-обёртка с CSS-подсветкой при наведении и событием `deskbook:workplace-click` для интеграции.

## Логирование

По умолчанию — текстовый формат (`slog.TextHandler`). Для JSON-логов установить `APP_ENV=production`.

## Локальный запуск

Если Go установлен (требуется Go 1.22+):

```bash
cd backend-go
go test ./...
go run ./cmd/server
```

Если Go не установлен — через Docker:

```bash
docker run --rm -v "$PWD/backend-go:/src" -w /src golang:1.23-alpine go test ./...
```

## HTTP API

Сервис предоставляет следующие эндпоинты:

### Здоровье
- `GET /health`

### Рендеринг
- `POST /render/svg`, `POST /render/html`

### Авторизация
- `POST /auth/register`, `POST /auth/login`

### Приглашения
- `POST /admin/invites`, `GET /admin/invites`, `DELETE /admin/invites/{invite_id}`
- `GET /invites/{token}`

### Пользователи
- `GET /users/me`, `GET /users`
- `GET /admin/users`, `PATCH /admin/users/{username}`, `DELETE /admin/users/{username}`

### Здания
- `GET /offices`, `POST /offices`
- `PATCH /offices/{office_id}`, `DELETE /offices/{office_id}`

### Этажи
- `GET /floors`, `POST /floors`
- `PATCH /floors/{floor_id}`, `DELETE /floors/{floor_id}`
- `POST /floors/{floor_id}/plan`

### Компоненты
- `GET /components`, `POST /components`
- `PUT /components/{component_id}`, `DELETE /components/{component_id}`

### Блоки
- `GET /blocks`, `POST /blocks`, `DELETE /blocks/{block_id}`

### Шаблоны
- `GET /templates`, `POST /templates`, `DELETE /templates/{template_id}`

### Рабочие места
- `GET /desks`, `GET /desks/{desk_id}`
- `PATCH /desks/{desk_id}`, `DELETE /desks/{desk_id}`

### Карта этажа (layout)
- `GET /floors/{floor_id}/layout` — текущее состояние (draft или published)
- `PUT /floors/{floor_id}/layout/draft` — сохранить черновик
- `DELETE /floors/{floor_id}/layout/draft` — отменить черновик
- `POST /floors/{floor_id}/layout/import` — импорт SVG
- `POST /floors/{floor_id}/layout/publish` — опубликовать
- `POST /floors/{floor_id}/layout/sync-desks` — синхронизация рабочих мест
- `GET /floors/{floor_id}/layout/published` — опубликованный JSON
- `GET /floors/{floor_id}/layout/published.svg` — опубликованный SVG
- `GET /floors/{floor_id}/layout/published.html` — опубликованный HTML
- `GET /floors/{floor_id}/layout/history` — аудит-лог
- `GET /floors/{floor_id}/layout/revisions` — список ревизий
- `GET /floors/{floor_id}/layout/revisions/{revision_id}` — конкретная ревизия
- `POST /floors/{floor_id}/layout/revisions/{revision_id}/restore` — восстановление

### Блокировка этажа
- `GET /floors/{floor_id}/lock`, `POST /floors/{floor_id}/lock`, `DELETE /floors/{floor_id}/lock`

### Встраивание
- `GET /embed/floors/{floor_id}`

### Администрирование
- `POST /admin/cleanup/revisions`

### Документация
- `GET /docs` — Swagger UI с интерактивной документацией API

## Авторизация

Admin write-операции валидируют HS256 JWT через `SECRET_KEY` и требуют `role=admin`. Регистрация — только по приглашению.

## Миграции

Используется [goose](https://github.com/pressly/goose) с embedded SQL-файлами. Миграции применяются автоматически при старте сервера (или вручную через compose-сервис `migrate`). Файлы: `migrations/00001_schema.sql`, `00002_templates.sql`, `00003_blocks.sql`.

## Запуск через Docker Compose

```bash
docker compose up -d --build
curl http://localhost:8000/health
bash tests/smoke_test.sh
```

## Тесты

Unit-тесты (без базы данных):

```bash
# Локально
go test ./... -count=1

# Через Docker
docker run --rm -v "$PWD/backend-go:/app" -w /app golang:1.23-alpine go test ./... -count=1
```

Contract-тесты (требуют запущенный compose-стек):

```bash
bash tests/go_renderer_contract.sh
bash tests/go_components_contract.sh
bash tests/go_layout_contract.sh
bash tests/smoke_test.sh
```

## Добавление нового endpoint

1. Добавить handler в `internal/handler/` (файл по домену: `offices_floors.go`, `layouts.go`, ...)
2. Зарегистрировать маршрут в `internal/handler/handler.go` (`Routes()`)
3. Добавить CRUD-метод в `internal/store/` если нужен новый SQL
4. Обновить `backend-go/openapi.yaml` и скопировать:
   `cp backend-go/openapi.yaml backend-go/internal/handler/swagger-ui/openapi.yaml`
5. Добавить тест
