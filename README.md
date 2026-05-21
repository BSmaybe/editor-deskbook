# DeskBook

Редактор карт офисных этажей. Админка для создания зданий, этажей, библиотеки компонентов, редактирования layout и публикации интерактивных SVG/HTML карт.

## Быстрый старт (локально)

```bash
docker compose up --build -d
```

| Сервис | URL |
| --- | --- |
| React admin | http://localhost:5175 |
| Go API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |

Порты 5175, 8000 и 5432 открываются через `docker-compose.override.yml` (для разработки). Первый админ создаётся автоматически из `BOOTSTRAP_ADMIN_*` в `.env`.

## Локальная разработка

Go API (требует Go 1.22+):

```bash
cd backend-go
go test ./...
go run ./cmd/server
```

React admin с hot reload:

```bash
cd frontend/admin-react
npm install
npm run dev      # http://localhost:5175
npm run lint     # ESLint
npm run test     # Vitest unit-тесты
```

Dev server на `http://localhost:5175`, проксирует `/api` в Go API.

## Архитектура

```
backend-go/
  cmd/server/          Точка входа — HTTP-сервер, настройка slog, goose-миграции
  internal/
    handler/           HTTP-хендлеры (auth, offices, floors, components, layouts, ...)
    store/             CRUD-обёртки над БД (pgx/v5)
    store/db/          sqlc-генерированные запросы
    store/queries/     SQL-шаблоны для sqlc
    auth/              JWT-утилиты (HS256)
    exporter/          layout_json → семантический SVG/HTML
    svgimport/         SVG-импорт и классификация элементов
  migrations/          SQL-миграции (goose, embedded)

frontend/admin-react/
  src/                 React admin UI (Vite + React 18)
  src/lib/             Хуки и утилиты канваса (useViewport, useGrid, ...)
  nginx.conf           /api proxy → Go API

scripts/
  backup.sh            Бэкап PostgreSQL с ротацией
  restore.sh           Восстановление из бэкапа
  gen-secrets.sh       Генерация .env.production

tests/
  smoke_test.sh        Smoke-тест всего контура
  go_renderer_contract.sh
  go_components_contract.sh
  go_layout_contract.sh
```

## Auth и регистрация

- `POST /auth/login` выдаёт JWT (HS256). Admin-эндпоинты требуют `role=admin`.
- Регистрация invite-only: админ создаёт invite на конкретный email, пользователь переходит по ссылке `/?invite=<token>` и регистрируется. Invite одноразовый.

## API

Полный список эндпоинтов — в [backend-go/README.md](backend-go/README.md).

Основные группы:
- **Auth**: `/auth/login`, `/auth/register`
- **Invites**: `/admin/invites`, `/invites/{token}`
- **Здания/этажи**: `/offices`, `/floors`
- **Компоненты**: `/components`
- **Блоки/шаблоны**: `/blocks`, `/templates`
- **Layout**: `/floors/{id}/layout/*` (draft, publish, import, history, revisions, lock)
- **Экспорт**: `/render/svg`, `/render/html`, `published.svg`, `published.html`
- **Desks**: `/desks`
- **Embed**: `/embed/floors/{id}`

## Тесты

```bash
# Backend unit + integration
cd backend-go && go test ./... -count=1

# Contract tests (требуют запущенный стек)
bash tests/go_renderer_contract.sh
bash tests/go_components_contract.sh
bash tests/go_layout_contract.sh
bash tests/smoke_test.sh

# Frontend
cd frontend/admin-react && npm test
```

## Деплой на сервер

```bash
# 1. Сгенерировать production секреты
bash scripts/gen-secrets.sh
cp .env.production .env

# 2. Удалить dev-override (он открывает лишние порты)
rm -f docker-compose.override.yml

# 3. Запустить
docker compose up --build -d
```

Наружу открыт только порт 80 (nginx). PostgreSQL и Go API доступны только внутри Docker-сети. Порт можно сменить через `DESKBOOK_PORT` в `.env`.

### HTTPS / TLS (опционально)

Для production с Let's Encrypt:

```bash
# Сначала убедиться что домен указывает на сервер
export DESKBOOK_DOMAIN=maps.example.com
bash scripts/setup-ssl.sh

# Использовать SSL overlay
docker compose -f docker-compose.yml -f docker-compose.ssl.yml up -d
```

### Логирование

API логирует в текстовом формате по умолчанию. Для JSON-логов в production:

```
APP_ENV=production
```

### Обслуживание

```bash
bash scripts/backup.sh          # бэкап PostgreSQL (ротация 30 копий)
bash scripts/restore.sh <file>  # восстановление из бэкапа
```

Cleanup старых ревизий: `POST /admin/cleanup/revisions?older_than_days=90`.

## Онбординг

Для новых разработчиков — интерактивный скрипт, который проведёт через весь API за 5–10 минут:

```bash
bash scripts/onboarding.sh
```

## Документация

- [Онбординг](docs/TECH_LEAD_HANDOFF_QA.md) — архитектура, FAQ, workflow, troubleshooting
- [API](docs/API.md) — полная документация по всем эндпоинтам с примерами
- [Go API](backend-go/README.md) — список эндпоинтов и контракт экспорта SVG/HTML
- [Swagger UI](http://localhost:8000/docs) — интерактивная документация (на русском)
