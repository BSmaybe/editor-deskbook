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
| PostgreSQL | localhost:5432 |

Порты 5175, 8000 и 5432 открываются через `docker-compose.override.yml` (для разработки). Первый админ создаётся автоматически из `BOOTSTRAP_ADMIN_*` в `.env`.

## Локальная разработка

Go API:

```bash
cd backend-go
go test ./...
go run ./cmd/server
```

React admin с hot reload:

```bash
cd frontend/admin-react
npm install
npm run dev
```

Dev server на `http://localhost:5175`, проксирует `/api` в Go API.

## Архитектура

```
backend-go/
  cmd/server/          Go HTTP API (auth, CRUD, layout, export)
  internal/exporter/   layout_json -> semantic SVG/HTML
  internal/svgimport/  SVG import и классификация
  migrations/          PostgreSQL schema

frontend/admin-react/
  src/                 React admin UI (Vite)
  nginx.conf           /api proxy -> Go API

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
bash tests/go_renderer_contract.sh
bash tests/go_components_contract.sh
bash tests/go_layout_contract.sh
bash tests/smoke_test.sh
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
