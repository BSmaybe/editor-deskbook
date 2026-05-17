# DeskBook Editor

DeskBook сейчас сфокусирован на редакторе карт офисных этажей:

- React-админка для зданий, этажей, компонентов и layout editor.
- Go API для auth, справочников, компонентов, draft/publish workflow и SVG/HTML export.
- PostgreSQL для пользователей, зданий, этажей, ревизий карт и синхронизированных рабочих мест.

Бронирования, политики, аналитика, QR/check-in, клиентское приложение и landing заморожены на время миграции редактора. Их API-маршруты остаются только как `501 Not Implemented` placeholders.

## Быстрый Старт

### Требования

- Docker и Docker Compose v2
- `curl` и `jq` для contract/smoke проверок

### Запуск

```bash
cp .env.example .env
docker compose up --build -d
```

| Сервис | URL |
| --- | --- |
| React admin | http://localhost:5175 |
| Go API | http://localhost:8000 |
| PostgreSQL | localhost:5432 |

Админка проксирует `/api/*` в Go API. Миграции PostgreSQL выполняет compose-сервис `migrate` перед стартом API.

## Локальная Разработка

Backend:

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

Dev server доступен на `http://localhost:5175` и проксирует `/api` в `http://localhost:8000`.

## Основные API

- `POST /auth/register`
- `POST /auth/login`
- `GET /offices`
- `POST /offices`
- `PATCH /offices/{office_id}`
- `DELETE /offices/{office_id}`
- `GET /floors`
- `POST /floors`
- `PATCH /floors/{floor_id}`
- `DELETE /floors/{floor_id}`
- `GET /components`
- `POST /components`
- `PUT /components/{component_id}`
- `DELETE /components/{component_id}`
- `GET /floors/{floor_id}/layout`
- `PUT /floors/{floor_id}/layout/draft`
- `POST /floors/{floor_id}/layout/publish`
- `POST /floors/{floor_id}/layout/import`
- `GET /floors/{floor_id}/layout/published.svg`
- `GET /floors/{floor_id}/layout/published.html`
- `GET /floors/{floor_id}/layout/history`
- `GET /floors/{floor_id}/layout/revisions`
- `GET /floors/{floor_id}/lock`

Admin write operations require a Bearer JWT with `role=admin`.

## Проверки

```bash
bash tests/go_renderer_contract.sh
bash tests/go_components_contract.sh
bash tests/go_layout_contract.sh
bash tests/smoke_test.sh
```

`tests/smoke_test.sh` проверяет текущий editor-only контур: health, auth, CRUD зданий/этажей, сохранение и публикацию layout, экспорт SVG/HTML, синхронизацию workplace-объектов и frozen placeholders.

## Структура

```text
backend-go/
  cmd/server/        Go HTTP API
  internal/exporter/ layout_json -> semantic SVG/HTML
  internal/svgimport SVG import/classification
  migrations/        PostgreSQL schema

frontend/admin-react/
  src/               React admin UI
  nginx.conf         /api proxy to Go API

tests/
  *_contract.sh      API/export contract checks
  smoke_test.sh      editor-only smoke test
```

## Документы

- [Go + React migration](docs/GO_REACT_EDITOR_MIGRATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Next steps](docs/NEXT_STEPS.md)
